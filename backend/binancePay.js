const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY;

if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) {
  throw new Error('Binance API keys are not set in .env');
}

const BINANCE_PAY_ENDPOINT = 'https://bpay.binanceapi.com/binancepay/openapi/v3/order';

function getSignature(payload, timestamp) {
  const content = `${BINANCE_API_KEY}\n${timestamp}\n${payload}\n`;
  return crypto.createHmac('sha512', BINANCE_SECRET_KEY).update(content).digest('hex');
}

async function createBinancePayOrder(amount, currency = 'USDT') {
  const timestamp = Date.now().toString();
  const payload = JSON.stringify({
    merchantTradeNo: 'order_' + Date.now(),
    totalFee: amount * 100, // Binance Pay uses cents
    currency,
    goods: {
      goodsType: '01',
      goodsCategory: 'D000',
      referenceGoodsId: 'ticket',
      goodsName: 'Mosabaqat Alomr Ticket',
      goodsDetail: 'Buy ticket for Mosabaqat Alomr'
    }
  });
  const signature = getSignature(payload, timestamp);
  const headers = {
    'Content-Type': 'application/json',
    'BinancePay-Timestamp': timestamp,
    'BinancePay-Certificate-SN': BINANCE_API_KEY,
    'BinancePay-Signature': signature
  };
  const response = await axios.post(BINANCE_PAY_ENDPOINT, payload, { headers });
  if (response.data && response.data.status === 'SUCCESS') {
    return response.data.data.prepayUrl;
  } else {
    throw new Error(response.data ? response.data.errorMessage : 'Unknown Binance Pay error');
  }
}

module.exports = { createBinancePayOrder };

const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY;

if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) {
  console.error('❌ Binance API keys are not set in .env');
  throw new Error('Binance API keys are not set in .env');
}

console.log('✅ Binance API Key loaded:', BINANCE_API_KEY.substring(0, 10) + '...');

const BINANCE_PAY_ENDPOINT = 'https://bpay.binanceapi.com/binancepay/openapi/v3/order';

function getSignature(payload, timestamp) {
  const content = `${timestamp}\n${crypto.randomBytes(16).toString('hex')}\n${payload}\n`;
  return crypto.createHmac('sha512', BINANCE_SECRET_KEY).update(content).digest('hex');
}

async function createBinancePayOrder(amount, currency = 'USDT') {
  try {
    console.log('💳 Creating Binance Pay order...');
    console.log('💵 Amount:', amount, currency);
    
    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const merchantTradeNo = 'order_' + timestamp;
    
    const requestBody = {
      env: {
        terminalType: 'WEB'
      },
      merchantTradeNo: merchantTradeNo,
      orderAmount: parseFloat(amount).toFixed(2),
      currency: currency,
      goods: {
        goodsType: '01',
        goodsCategory: 'D000',
        referenceGoodsId: 'ticket_' + timestamp,
        goodsName: 'Mosabaqat Alomr Ticket',
        goodsDetail: 'Buy ticket for Mosabaqat Alomr'
      }
    };
    
    const payload = JSON.stringify(requestBody);
    const signatureContent = `${timestamp}\n${nonce}\n${payload}\n`;
    const signature = crypto.createHmac('sha512', BINANCE_SECRET_KEY).update(signatureContent).digest('hex').toUpperCase();
    
    const headers = {
      'Content-Type': 'application/json',
      'BinancePay-Timestamp': timestamp,
      'BinancePay-Nonce': nonce,
      'BinancePay-Certificate-SN': BINANCE_API_KEY,
      'BinancePay-Signature': signature
    };
    
    console.log('📤 Sending request to Binance Pay...');
    const response = await axios.post(BINANCE_PAY_ENDPOINT, requestBody, { headers });
    
    console.log('📥 Response status:', response.data.status);
    
    if (response.data && response.data.status === 'SUCCESS') {
      const paymentUrl = response.data.data.qrcodeLink || response.data.data.universalUrl || response.data.data.deeplink;
      console.log('✅ Payment URL created:', paymentUrl);
      return paymentUrl;
    } else {
      const errorMsg = response.data ? (response.data.errorMessage || JSON.stringify(response.data)) : 'Unknown Binance Pay error';
      console.error('❌ Binance Pay error:', errorMsg);
      throw new Error(errorMsg);
    }
  } catch (error) {
    console.error('❌ Binance Pay request failed:', error.message);
    if (error.response) {
      console.error('❌ Response data:', JSON.stringify(error.response.data));
      console.error('❌ Response status:', error.response.status);
    }
    throw error;
  }
}

module.exports = { createBinancePayOrder };

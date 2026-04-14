import 'package:flutter/material.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'config.dart';

void main() {
  runApp(const MosabaqatAlomrApp());
}

class MosabaqatAlomrApp extends StatelessWidget {
  const MosabaqatAlomrApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'مسابقة العمر',
      theme: ThemeData(primarySwatch: Colors.blue, useMaterial3: true),
      home: const RegistrationScreen(),
    );
  }
}

class RegistrationScreen extends StatefulWidget {
  const RegistrationScreen({super.key});

  @override
  State<RegistrationScreen> createState() => _RegistrationScreenState();
}

class _RegistrationScreenState extends State<RegistrationScreen> {
  final TextEditingController _nameController = TextEditingController();
  bool _isConnecting = false;

  Future<void> _handleRegister() async {
    if (_nameController.text.isEmpty) return;

    setState(() => _isConnecting = true);
    try {
      final response = await http.post(
        Uri.parse('${Config.baseUrl}/register'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'username': _nameController.text}),
      );

      if (response.statusCode == 201) {
        final data = jsonDecode(response.body);
        if (!mounted) return;
        
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (context) => InternalDashboardPage(
              name: data['username'],
              number: data['registrationNumber'].toString(),
            ),
          ),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تعذر الاتصال بالسيرفر، تأكد من تشغيله')),
      );
    } finally {
      setState(() => _isConnecting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('التسجيل في مسابقة العمر'), centerTitle: true),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // العبارة التوضيحية أعلى الشاشة (مرفوعة للأعلى)
            Padding(
              padding: const EdgeInsets.only(top: 8, bottom: 12),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
                decoration: BoxDecoration(
                  color: Colors.green[50],
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: Colors.green, width: 1.2),
                ),
                child: const Text(
                  'فرصتك للربح وكن سببًا في مساعدة المحتاجين',
                  style: TextStyle(fontWeight: FontWeight.bold, color: Colors.green, fontSize: 17),
                  textAlign: TextAlign.center,
                ),
              ),
            ),
            TextField(
              controller: _nameController,
              decoration: const InputDecoration(labelText: 'اسم المشارك كامل', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 20),
            _isConnecting 
              ? const CircularProgressIndicator() 
              : ElevatedButton(onPressed: _handleRegister, child: const Text('تسجيل الحصول على رقم المشاركة')),
            const SizedBox(height: 30),
            OutlinedButton(
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (context) => const DeveloperLoginScreen()),
                );
              },
              child: const Text('تسجيل دخول المطور'),
            ),
          ],
        ),
      ),
    );
  }

// شاشة تسجيل دخول المطور
class DeveloperLoginScreen extends StatefulWidget {
  const DeveloperLoginScreen({super.key});

  @override
  State<DeveloperLoginScreen> createState() => _DeveloperLoginScreenState();
}

class _DeveloperLoginScreenState extends State<DeveloperLoginScreen> {
  final TextEditingController _emailController = TextEditingController(text: 'developer@mosabaqa.com');
  final TextEditingController _passwordController = TextEditingController(text: 'devpass2026');
  bool _isLoggingIn = false;

  Future<void> _handleLogin() async {
    setState(() => _isLoggingIn = true);
    try {
      final response = await http.post(
        Uri.parse('${Config.baseUrl}/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'username': _emailController.text.trim(),
          'password': _passwordController.text
        }),
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (!mounted) return;
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(builder: (context) => DeveloperDashboardScreen(token: data['token'], username: data['username'])),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('بيانات الدخول غير صحيحة')));
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('خطأ في الاتصال بالسيرفر')));
    } finally {
      setState(() => _isLoggingIn = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('دخول المطور'), centerTitle: true),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            TextField(
              controller: _emailController,
              decoration: const InputDecoration(
                labelText: 'الإيميل',
                border: OutlineInputBorder(),
                hintText: 'developer@mosabaqa.com',
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _passwordController,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'كلمة المرور',
                border: OutlineInputBorder(),
                hintText: 'devpass2026',
              ),
            ),
            // شاشة المطور بعد الدخول: عرض بيانات المستخدمين
            class DeveloperDashboardScreen extends StatefulWidget {
              final String token;
              final String username;
              const DeveloperDashboardScreen({super.key, required this.token, required this.username});

              @override
              State<DeveloperDashboardScreen> createState() => _DeveloperDashboardScreenState();
            }

            class _DeveloperDashboardScreenState extends State<DeveloperDashboardScreen> {
              List<dynamic> users = [];
              bool isLoading = true;
              List<dynamic> news = [];
              final TextEditingController _newsTitleController = TextEditingController();
              final TextEditingController _newsContentController = TextEditingController();
              bool isPostingNews = false;

              Future<void> fetchUsers() async {
                setState(() => isLoading = true);
                try {
                  final response = await http.get(Uri.parse('${Config.baseUrl}/participants'));
                  if (response.statusCode == 200) {
                    users = jsonDecode(response.body);
                  }
                } catch (e) {}
                setState(() => isLoading = false);
              }

              Future<void> fetchNews() async {
                try {
                  final response = await http.get(Uri.parse('${Config.baseUrl}/news'));
                  if (response.statusCode == 200) {
                    setState(() { news = jsonDecode(response.body); });
                  }
                } catch (e) {}
              }

              Future<void> postNews() async {
                if (_newsTitleController.text.isEmpty || _newsContentController.text.isEmpty) return;
                setState(() => isPostingNews = true);
                try {
                  final response = await http.post(
                    Uri.parse('${Config.baseUrl}/news'),
                    headers: {'Content-Type': 'application/json'},
                    body: jsonEncode({
                      'title': _newsTitleController.text,
                      'content': _newsContentController.text,
                    }),
                  );
                  if (response.statusCode == 201) {
                    _newsTitleController.clear();
                    _newsContentController.clear();
                    fetchNews();
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تم نشر الخبر بنجاح')));
                  }
                } catch (e) {
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('فشل نشر الخبر')));
                } finally {
                  setState(() => isPostingNews = false);
                }
              }

              @override
              void initState() {
                super.initState();
                fetchUsers();
                fetchNews();
              }

              @override
              Widget build(BuildContext context) {
                return Scaffold(
                  appBar: AppBar(title: const Text('لوحة المطور'), centerTitle: true),
                  body: isLoading
                      ? const Center(child: CircularProgressIndicator())
                      : SingleChildScrollView(
                          child: Padding(
                            padding: const EdgeInsets.all(16.0),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                // مربع كتابة الخبر (بارز وواضح)
                                Container(
                                  padding: const EdgeInsets.all(20),
                                  margin: const EdgeInsets.only(bottom: 32),
                                  decoration: BoxDecoration(
                                    color: Colors.yellow[50],
                                    borderRadius: BorderRadius.circular(16),
                                    border: Border.all(color: Colors.amber, width: 2),
                                    boxShadow: [BoxShadow(color: Colors.amber.withOpacity(0.08), blurRadius: 8)],
                                  ),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        children: const [
                                          Icon(Icons.announcement, color: Colors.amber, size: 28),
                                          SizedBox(width: 8),
                                          Text('كتابة خبر جديد', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: Colors.amber)),
                                        ],
                                      ),
                                      const SizedBox(height: 12),
                                      TextField(
                                        controller: _newsTitleController,
                                        decoration: const InputDecoration(labelText: 'عنوان الخبر', border: OutlineInputBorder()),
                                      ),
                                      const SizedBox(height: 12),
                                      TextField(
                                        controller: _newsContentController,
                                        minLines: 2,
                                        maxLines: 5,
                                        decoration: const InputDecoration(labelText: 'محتوى الخبر', border: OutlineInputBorder()),
                                      ),
                                      const SizedBox(height: 12),
                                      isPostingNews
                                          ? const Center(child: CircularProgressIndicator())
                                          : SizedBox(
                                              width: double.infinity,
                                              child: ElevatedButton.icon(
                                                onPressed: postNews,
                                                icon: const Icon(Icons.send),
                                                label: const Text('نشر الخبر'),
                                                style: ElevatedButton.styleFrom(backgroundColor: Colors.amber),
                                              ),
                                            ),
                                    ],
                                  ),
                                ),
                                // قائمة الأخبار
                                const Text('آخر الأخبار:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                                ...news.map((n) => Card(
                                      margin: const EdgeInsets.symmetric(vertical: 6),
                                      child: ListTile(
                                        title: Text(n['title'] ?? ''),
                                        subtitle: Text(n['content'] ?? ''),
                                        trailing: Text(n['date'] != null ? n['date'].toString().substring(0, 10) : ''),
                                      ),
                                    )),
                                const SizedBox(height: 24),
                                const Divider(),
                                const Text('قائمة المستخدمين:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                                ...users.map((user) => ListTile(
                                      leading: const Icon(Icons.person),
                                      title: Text(user['username'].toString()),
                                      subtitle: Text('رقم المشاركة: ${user['registrationNumber']}'),
                                    )),
                              ],
                            ),
                          ),
                        ),
                );
              }
            }
            const SizedBox(height: 24),
            _isLoggingIn
                ? const CircularProgressIndicator()
                : ElevatedButton(
                    onPressed: _handleLogin,
                    child: const Text('دخول'),
                  ),
          ],
        ),
      ),
    );
  }
}
}

class InternalDashboardPage extends StatelessWidget {
  final String name;
  final String number;

  const InternalDashboardPage({super.key, required this.name, required this.number});

  @override
  Widget build(BuildContext context) {
    final List<Map<String, dynamic>> options = [
      {'title': 'شراء الأسهم وبدء الشراء', 'icon': Icons.shopping_cart},
      {'title': 'عرض أرقامك', 'icon': Icons.format_list_numbered},
    ];

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            const Text('لوحة المشاركة'),
            Text(
              name,
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w400, color: Colors.white70),
            ),
          ],
        ),
        centerTitle: true,
      ),
      body: NewsAndDashboard(name: name, number: number, options: options),
    );
  }
}

// Widget لعرض الأخبار أعلى لوحة المستخدم
class NewsAndDashboard extends StatefulWidget {
  final String name;
  final String number;
  final List<Map<String, dynamic>> options;
  const NewsAndDashboard({super.key, required this.name, required this.number, required this.options});

  @override
  State<NewsAndDashboard> createState() => _NewsAndDashboardState();
}

class _NewsAndDashboardState extends State<NewsAndDashboard> {
  List<dynamic> news = [];
  bool isLoading = true;

  @override
  void initState() {
    super.initState();
    fetchNews();
  }

  Future<void> fetchNews() async {
    setState(() => isLoading = true);
    try {
      final response = await http.get(Uri.parse('${Config.baseUrl}/news'));
      if (response.statusCode == 200) {
        setState(() { news = jsonDecode(response.body); });
      }
    } catch (e) {}
    setState(() => isLoading = false);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // مربع الأخبار الأبيض
        Container(
          width: double.infinity,
          margin: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            boxShadow: [BoxShadow(color: Colors.black12, blurRadius: 4)],
          ),
          child: isLoading
              ? const Center(child: CircularProgressIndicator())
              : (news.isEmpty
                  ? const Text('لا توجد أخبار حالياً', style: TextStyle(color: Colors.grey))
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('الأخبار', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                        const SizedBox(height: 8),
                        ...news.take(3).map((n) => Padding(
                              padding: const EdgeInsets.symmetric(vertical: 4),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(n['title'] ?? '', style: const TextStyle(fontWeight: FontWeight.bold)),
                                  Text(n['content'] ?? ''),
                                  if (n['date'] != null)
                                    Text(n['date'].toString().substring(0, 10), style: const TextStyle(fontSize: 12, color: Colors.grey)),
                                  const Divider(),
                                ],
                              ),
                            )),
                      ],
                    )),
        ),
        // ...لوحة المستخدمين كما كانت
        Container(
          padding: const EdgeInsets.all(20),
          color: Colors.blue.withOpacity(0.1),
          width: double.infinity,
          child: Column(
            children: [
              Text('مرحباً بك: ${widget.name}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w500)),
              const SizedBox(height: 8),
              Text('رقم مشاركتك الخاص: ${widget.number}', style: const TextStyle(fontSize: 24, color: Colors.blue, fontWeight: FontWeight.bold)),
            ],
          ),
        ),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.all(16.0),
            child: GridView.builder(
              itemCount: widget.options.length,
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                crossAxisSpacing: 15,
                mainAxisSpacing: 15,
              ),
              itemBuilder: (context, index) {
                return Card(
                  elevation: 4,
                  child: InkWell(
                    onTap: () => print('تم اختيار: \\${widget.options[index]['title']}'),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(widget.options[index]['icon'], size: 40, color: Colors.blue),
                        const SizedBox(height: 10),
                        Text(widget.options[index]['title'], textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      ],
    );
  }
}
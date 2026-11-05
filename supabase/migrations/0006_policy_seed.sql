-- Seed policy versions (drafts — require legal review before production)
alter table public.policy_versions drop constraint if exists policy_versions_slug_key;
alter table public.policy_versions add constraint policy_versions_slug_locale_key unique (slug, version, locale);

insert into public.policy_versions (slug, version, locale, title, body) values
('terms','1.0','tr','Kullanım Şartları',
'# Kullanım Şartları

Bu şartlar EyyE uygulamasını kullanırken geçerlidir. 18 yaşından küçük kullanıcılar hesab oluşturamaz.

## Hesap
Kullanıcı adları benzersiz olmalı, başkasını yanıltacak şekilde seçilemez. Hesap güvenliği kullanıcı sorumluluğundadır.

## İçerik
Kullanıcılar paylaştıkları içerikten sorumludur. Çocuk istismarı, cinsel içerik, tehdit, nefret söylemi ve dolandırıcılık kesinlikle yasaktır.

## Yaptırımlar
İhlallerde hesap kısıtlama, askıya alma veya kalıcı kapatma uygulanabilir. Detaylar Moderasyon Politikası''nda yer alır.'),
('privacy','1.0','tr','Gizlilik Politikası',
'# Gizlilik Politikası

## Toplanan veriler
Ad, e-posta, kullanıcı adı, doğum tarihi, ülke, şehir, profil fotoğrafları, mesajlar ve medya meta verileri.

## Kullanım
Veriler hizmetin sunulması, güvenlik, moderasyon ve bildirim amacıyla işlenir. Mesaj içerikleri moderasyon amacıyla yalnızca şikâyet durumunda incelenir.

## Paylaşım
Veriler üçüncü taraflarla satılmaz. Altyapı sağlayıcıları (Supabase, Cloudflare) sınırlı erişimle hizmet verir.

## Haklar
Kullanıcı verilerini dışa aktarabilir ve hesabını silebilir. Silme talebi Ayarlar > Hesap üzerinden yapılır.'),
('community','1.0','tr','Topluluk Kuralları',
'# Topluluk Kuralları

- Başka kullanıcılara saygılı davranın.
- Taciz, zorbalık, tehdit ve nefret söylemi yasaktır.
- Çocuk güvenliği ihlalleri sıfır toleransla ele alınır.
- Spam, dolandırıcılık ve sahte hesaplar yasaktır.
- Telif hakkı ihlallerinden kaçının.
- Uygunsuz içerik bildirilirse moderasyon ekibi inceler.'),
('child-safety','1.0','tr','Çocuk Güvenliği Politikası',
'# Çocuk Güvenliği ve Çocukların Cinsel İstismarını Önleme Politikası

EyyE çocukların cinsel istismarını ve sömürüsünü kesinlikle yasaklar. Sıfır tolerans politikası uygulanır.

## Yasaklar
- Çocukların cinsel istismarı/sömürüsü içeriği oluşturmak, yüklemek, paylaşmak, talep etmek veya dağıtmak.
- Çocuklara yönelik cinsel amaçlı iletişim ve grooming.
- Çocukları cinsel içerik üretmeye yönlendirmek.
- Bu amaçla şantaj, tehdit ve manipülasyon.
- Reşit olmayan kişilerle cinsel amaçlı buluşma girişimleri.

## Süreç
- Çocuk güvenliği bildirimleri kritik öncelikle incelenir.
- İhlal eden içerikler kaldırılır, hesaplar askıya alınır veya kapatılır.
- Gerekli durumlarda yetkili kurumlara bildirim yapılır.

## İletişim
Çocuk güvenliği ihlallerini uygulama içinden bildirebilir veya safety@eyye.app adresine yazabilirsiniz.'),
('report-policy','1.0','tr','Şikâyet ve Moderasyon Politikası',
'# Şikâyet, Moderasyon ve İtiraz Politikası

Kullanıcılar profil, mesaj, medya ve içerikleri bildirebilir. Her başvuruya benzersiz takip numarası verilir.

## Durumlar
Başvuru Alındı > Ön İnceleme > İnceleme > (Ek Bilgi Bekleniyor) > Karar Verildi/Sonuçlandı. İtirazlar ayrı moderatör tarafından incelenir.

## Şeffaflık
Kullanıcılara şikâyet edilenin özel bilgileri ve iç moderasyon notları açıklanmaz.'),
('account-deletion','1.0','tr','Hesap Silme ve Veri Saklama Politikası',
'# Hesap Silme ve Veri Saklama

Kullanıcı hesabını Ayarlar üzerinden silebilir. Silme talebinde kişisel profil verileri anonimleştirilir.

## Saklama
- Mesajlar: hesap silindikten sonra konuşma ortakları için gerekli olduğu sürece saklanabilir.
- Şikâyet ve moderasyon kayıtları: hukuki yükümlülükler gereği sınırlı süre saklanır.
- Yasal saklama gerektiren veriler ilgili mevzuata göre tutulur.')
on conflict (slug, version, locale) do nothing;

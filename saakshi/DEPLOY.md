# साइट साक्षी पोर्टल को ऑनलाइन कैसे डालें

पूरा पोर्टल एक ही सर्वर पर चलता है। अलग डेटाबेस सर्वर नहीं चाहिए, क्योंकि SQLite उसी में है।

## क्या चाहिए

| चीज़ | सुझाव |
|---|---|
| सर्वर (VPS) | 2 CPU, 4 GB RAM, 80 GB डिस्क, Ubuntu 22.04/24.04। एक ज़िले या विभाग के लिए काफ़ी है। सरकारी पोर्टल हो तो राज्य डेटा सेंटर (RSDC) या NIC क्लाउड (MeghRaj) पर। Pilot या ट्रस्ट के लिए कोई भी भारतीय क्लाउड चलेगा। |
| डोमेन | जैसे `saakshi.example.in` (सरकारी हो तो `*.gov.in` / `*.nic.in`) |
| SMS gateway | OTP के लिए: MSG91, Twilio, या सरकारी NIC SMS gateway। सरकारी SMS के लिए DLT पंजीकरण ज़रूरी है। |

## 5 क़दम

1. **डोमेन को सर्वर से जोड़ें:** डोमेन के DNS में एक `A` रिकॉर्ड बनाएँ जो सर्वर के IP पर जाए।
2. **सर्वर पर Docker डालें:**
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. **कोड लाएँ:**
   ```bash
   git clone <इस repo का पता> && cd <repo>/saakshi
   cp .env.example .env
   nano .env        # DOMAIN, ADMIN_MOBILE, ADMIN_PIN, SMS_WEBHOOK_URL भरें
   ```
4. **चालू करें:**
   ```bash
   docker compose up -d
   ```
   Caddy अपने-आप Let's Encrypt से HTTPS का सर्टिफ़िकेट ले लेता है। GPS और कैमरा सिर्फ़ HTTPS पर चलते हैं, इसलिए यह ज़रूरी है।
5. **पहला लॉगिन:** `https://<DOMAIN>` खोलें और `ADMIN_MOBILE` + `ADMIN_PIN` से लॉगिन करें। फिर "प्रबंधन" में:
   - **नियम** जाँचें (10%, 24 घंटे, 15 दिन…)।
   - विभाग के **इंजीनियरों और पंजीकृत ठेकेदारों की सूची** Excel से पेस्ट करें।
   - S.E. और मुख्यालय (HQ) के खाते बनाएँ।

## SMS gateway जोड़ना

`.env` में `SMS_WEBHOOK_URL` उस पते पर सेट करें जो `POST {"to": "98xxxxxxxx", "message": "..."}` लेता हो। ज़्यादातर gateway का API अलग फ़ॉर्मेट माँगता है। उसके लिए 10 लाइन का एक छोटा adapter लिखना पड़ता है, जिसमें मदद ली जा सकती है। SMS gateway के बिना OTP सिर्फ़ सर्वर के log में आएगा (`docker compose logs app`), इसलिए असली इस्तेमाल से पहले इसे ज़रूर जोड़ें।

## बैकअप (रोज़)

```bash
docker compose exec app node backup.js /data/backups
docker compose cp app:/data/backups ./backups      # सर्वर से बाहर कॉपी
```

इसे रोज़ चलाने के लिए cron में डालें (`crontab -e`):

```
30 2 * * * cd /path/to/saakshi && docker compose exec -T app node backup.js /data/backups && docker compose cp app:/data/backups ./backups
```

और `./backups` फ़ोल्डर को किसी दूसरी जगह (दूसरे सर्वर या क्लाउड स्टोरेज) पर भी भेजें।

## अपडेट

```bash
git pull && docker compose up -d --build
```

डेटा `saakshi_data` volume में रहता है, अपडेट से नहीं मिटता। नए कॉलम अपने-आप जुड़ जाते हैं।

## Docker के बिना

Node.js 22.5 या नया चाहिए:

```bash
ADMIN_MOBILE=... ADMIN_PIN=... PORT=8080 node server.js
```

इसे `systemd` सर्विस बनाकर चलाएँ, और आगे nginx या Caddy लगाकर HTTPS दें।

## सुरक्षा जाँच-सूची

- [ ] HTTPS चालू है (Caddy अपने-आप करता है)
- [ ] Admin का PIN बदला गया
- [ ] SMS gateway लगा है, यानी OTP स्क्रीन या log पर नहीं आ रहा
- [ ] रोज़ बैकअप हो रहा है और सर्वर से बाहर जा रहा है
- [ ] सर्वर पर सिर्फ़ पोर्ट 22, 80 और 443 खुले हैं (`ufw allow 22,80,443/tcp`)
- [ ] ख़ुद बने इंजीनियर खातों की पहचान विभाग अपने रिकॉर्ड से जाँचता है ("प्रबंधन" → "पहचान जाँची गई")

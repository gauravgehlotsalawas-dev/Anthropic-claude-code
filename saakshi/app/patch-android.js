'use strict';
// Runs after `cap add android`: permissions for GPS and camera, the fake-GPS bridge, the app icon and splash.
const fs = require('fs');
const path = require('path');
const A = path.join(__dirname, 'android', 'app', 'src', 'main');
const manifest = path.join(A, 'AndroidManifest.xml');
let m = fs.readFileSync(manifest, 'utf8');
const perms = ['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.CAMERA'];
const add = perms.filter((p) => !m.includes(p)).map((p) => `    <uses-permission android:name="${p}" />`).join('\n') +
  '\n    <uses-feature android:name="android.hardware.camera" android:required="false" />\n    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n';
m = m.replace('</manifest>', add + '</manifest>');
fs.writeFileSync(manifest, m);
// our MainActivity (adds window.SaakshiNative)
const javaDir = path.join(A, 'java', 'com', 'sitesaakshi', 'app');
fs.mkdirSync(javaDir, { recursive: true });
fs.copyFileSync(path.join(__dirname, 'native', 'MainActivity.java'), path.join(javaDir, 'MainActivity.java'));
// icon: the portal's own icon at every density; drop the adaptive XML so the PNG is used
const res = path.join(A, 'res');
const icon = path.join(__dirname, '..', 'public', 'icon-512.png');
for (const d of fs.readdirSync(res).filter((d) => d.startsWith('mipmap'))) {
  const dir = path.join(res, d);
  if (d.includes('anydpi')) { fs.rmSync(dir, { recursive: true, force: true }); continue; }
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.png')) fs.copyFileSync(icon, path.join(dir, f));
}
// splash: every splash.png becomes ours
const splash = path.join(__dirname, 'native', 'splash.png');
for (const d of fs.readdirSync(res).filter((d) => d.startsWith('drawable'))) {
  const f = path.join(res, d, 'splash.png');
  if (fs.existsSync(f)) fs.copyFileSync(splash, f);
}
console.log('Android project patched: permissions, SaakshiNative bridge, icon, splash');

package com.sitesaakshi.app;

import android.content.Context;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.app.Activity;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // window.SaakshiNative: lets the portal ask the phone whether the location comes from a fake-GPS app
    getBridge().getWebView().addJavascriptInterface(new SaakshiNative(this), "SaakshiNative");
  }

  public static class SaakshiNative {
    private final Context ctx;
    private final Activity activity;
    private WebView printing; // held until the print job is created

    SaakshiNative(Activity a) { activity = a; ctx = a.getApplicationContext(); }

    // bills and site boards: Android's own print screen (also "Save as PDF"), since WebView has no window.print()
    @JavascriptInterface
    public void printHtml(final String html, final String title) {
      activity.runOnUiThread(() -> {
        WebView w = new WebView(activity);
        w.setWebViewClient(new WebViewClient() {
          @Override
          public void onPageFinished(WebView view, String url) {
            PrintManager pm = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
            if (pm != null) pm.print(title, view.createPrintDocumentAdapter(title), new PrintAttributes.Builder().build());
            printing = null;
          }
        });
        printing = w;
        w.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
      });
    }

    @JavascriptInterface
    public String version() { return "1"; }

    @SuppressWarnings("deprecation")
    @JavascriptInterface
    public String locationCheck() {
      try {
        LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return "{\"known\":false}";
        Location best = null;
        for (String p : lm.getProviders(true)) {
          Location l = lm.getLastKnownLocation(p);
          if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
        }
        if (best == null) return "{\"known\":false}";
        boolean mock = Build.VERSION.SDK_INT >= 31 ? best.isMock() : best.isFromMockProvider();
        return "{\"known\":true,\"mock\":" + mock + ",\"age_ms\":" + (System.currentTimeMillis() - best.getTime()) + "}";
      } catch (SecurityException e) {
        return "{\"known\":false,\"error\":\"permission\"}";
      }
    }
  }
}

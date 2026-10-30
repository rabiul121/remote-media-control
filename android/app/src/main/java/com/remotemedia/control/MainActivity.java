package com.remotemedia.control;

import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanOptions;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class MainActivity extends ComponentActivity {
    private static final int BG = Color.rgb(11, 13, 19), PANEL = Color.rgb(20, 24, 35);
    private static final int TEXT = Color.rgb(240, 242, 250), MUTED = Color.rgb(153, 161, 179), LIME = Color.rgb(201, 243, 107);
    private EditText ipInput, portInput;
    private TextView homeStatus;
    private WebView web;
    private LinearLayout root;
    private FrameLayout webFrame;
    private LinearLayout waitCard;
    private TextView waitTitle, waitMessage;
    private String connectedUrl = "";
    private boolean loadFailed = false;
    private ActivityResultLauncher<ScanOptions> qrScanner;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(BG); getWindow().setNavigationBarColor(BG);
        qrScanner = registerForActivityResult(new ScanContract(), result -> {
            String contents = result == null ? null : result.getContents();
            if (contents == null) setHomeStatus("No QR code was scanned. You can try again or enter the IP and port.", MUTED);
            else pairFromQr(contents);
        });
        showConnect();
        String savedIp = getPreferences(MODE_PRIVATE).getString("ip", "");
        int savedPort = getPreferences(MODE_PRIVATE).getInt("port", 8765);
        if (savedIp.isEmpty()) {
            String oldUrl = getPreferences(MODE_PRIVATE).getString("url", "");
            try { Uri u = Uri.parse(oldUrl); if (u.getHost() != null) { savedIp=u.getHost(); savedPort=u.getPort()>0?u.getPort():8765; } } catch (Exception ignored) {}
        }
        String savedToken = getPreferences(MODE_PRIVATE).getString("pairToken", null);
        if (!savedIp.isEmpty()) connect(savedIp, savedPort, savedToken);
    }

    private GradientDrawable shape(int color, int stroke, int radius) {
        GradientDrawable d = new GradientDrawable(); d.setColor(color); d.setCornerRadius(dp(radius));
        if (stroke != 0) d.setStroke(dp(1), stroke); return d;
    }
    private int dp(float v) { return (int)(v * getResources().getDisplayMetrics().density + .5f); }
    private TextView text(String value, int size, int color, boolean bold) {
        TextView t = new TextView(this); t.setText(value); t.setTextSize(size); t.setTextColor(color);
        t.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL)); return t;
    }
    private LinearLayout column() { LinearLayout l = new LinearLayout(this); l.setOrientation(LinearLayout.VERTICAL); return l; }
    private LinearLayout.LayoutParams params(int w,int h) { return new LinearLayout.LayoutParams(w,h); }
    private void showConnect() {
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true);
        root = column(); root.setBackgroundColor(BG); root.setPadding(dp(25), dp(32), dp(25), dp(24)); scroll.addView(root); setContentView(scroll);
        TextView brand = text("◉   REMOTE / DECK", 13, LIME, true); brand.setLetterSpacing(.1f); root.addView(brand);
        TextView title = text("Your listening,\nwithin reach.", 34, TEXT, true); title.setLineSpacing(dp(1), 1f);
        LinearLayout.LayoutParams tp = params(-1, -2); tp.topMargin = dp(45); root.addView(title, tp);
        TextView desc = text("Connect to your Windows PC on the same Wi-Fi. Scan the QR from the tray menu, or enter the PC's IP and port.", 15, MUTED, false);
        desc.setLineSpacing(dp(5), 1f); LinearLayout.LayoutParams dp = params(-1, -2); dp.topMargin = dp(15); root.addView(desc, dp);
        LinearLayout row = new LinearLayout(this); row.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout fields = new LinearLayout(this); fields.setOrientation(LinearLayout.VERTICAL);
        TextView ipLabel = text("PC IP ADDRESS", 10, MUTED, true); ipLabel.setLetterSpacing(.1f); fields.addView(ipLabel);
        ipInput = new EditText(this); ipInput.setSingleLine(true); ipInput.setTextSize(15); ipInput.setTextColor(TEXT); ipInput.setHintTextColor(Color.rgb(91,99,116));
        ipInput.setHint("192.168.1.20"); ipInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        ipInput.setPadding(dp(13),0,dp(11),0); ipInput.setBackground(shape(PANEL, Color.rgb(42,48,64), 11));
        ipInput.setText(getPreferences(MODE_PRIVATE).getString("ip", "")); fields.addView(ipInput,params(-1,dp(52)));
        row.addView(fields,new LinearLayout.LayoutParams(0,-2,1f));
        LinearLayout portField = new LinearLayout(this); portField.setOrientation(LinearLayout.VERTICAL); portField.setPadding(dp(9),0,0,0);
        TextView portLabel = text("PORT", 10, MUTED, true); portLabel.setLetterSpacing(.1f); portField.addView(portLabel);
        portInput = new EditText(this); portInput.setSingleLine(true); portInput.setTextSize(15); portInput.setTextColor(TEXT); portInput.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        portInput.setPadding(dp(12),0,dp(8),0); portInput.setBackground(shape(PANEL, Color.rgb(42,48,64), 11));
        portInput.setText(String.valueOf(getPreferences(MODE_PRIVATE).getInt("port",8765))); portField.addView(portInput,params(dp(92),dp(52)));
        row.addView(portField); LinearLayout.LayoutParams rp=params(-1,-2);rp.topMargin=dp(26);root.addView(row,rp);
        Button scan = new Button(this); scan.setText("▦   Scan pairing QR"); scan.setTextColor(TEXT); scan.setTextSize(14); scan.setAllCaps(false); scan.setBackground(shape(PANEL,Color.rgb(42,48,64),12));
        LinearLayout.LayoutParams sp=params(-1,dp(52));sp.topMargin=dp(12);root.addView(scan,sp);scan.setOnClickListener(v->scanQr());
        Button connect = new Button(this); connect.setText("Connect   ↗"); connect.setTextColor(Color.rgb(19,24,11)); connect.setTextSize(15); connect.setAllCaps(false); connect.setTypeface(null,Typeface.BOLD); connect.setBackground(shape(LIME,0,12));
        LinearLayout.LayoutParams cp=params(-1,dp(53));cp.topMargin=dp(10);root.addView(connect,cp);connect.setOnClickListener(v->connectFromFields());
        ipInput.setImeOptions(EditorInfo.IME_ACTION_NEXT);
        portInput.setImeOptions(EditorInfo.IME_ACTION_GO); portInput.setOnEditorActionListener((v,a,e)->{if(a==EditorInfo.IME_ACTION_GO){connectFromFields();return true;}return false;});
        homeStatus=text("Enter the Wi-Fi IP shown by Pair phone in the Windows tray menu.",12,MUTED,false);homeStatus.setLineSpacing(dp(3),1f);
        LinearLayout.LayoutParams hp=params(-1,-2);hp.topMargin=dp(18);root.addView(homeStatus,hp);
        TextView footer=text("PAIR ON THE SAME PRIVATE WI-FI NETWORK",10,Color.rgb(103,111,129),false);footer.setLetterSpacing(.05f);
        LinearLayout.LayoutParams fp=params(-1,-2);fp.topMargin=dp(22);root.addView(footer,fp);
    }
    private void setHomeStatus(String message,int color){if(homeStatus!=null){homeStatus.setText(message);homeStatus.setTextColor(color);}}
    private void connectFromFields(){
        String host=ipInput.getText().toString().trim();String p=portInput.getText().toString().trim();
        if(!isIpv4Address(host)){setHomeStatus("Enter a valid Wi-Fi IPv4 address, such as 192.168.1.20.",Color.rgb(255,138,114));return;}
        int port;try{port=Integer.parseInt(p);}catch(Exception e){port=0;}
        if(port<1||port>65535){setHomeStatus("Port must be a number from 1 to 65535.",Color.rgb(255,138,114));return;}
        connect(host,port,null);
    }
    private boolean isIpv4Address(String host){String[] parts=host.split("\\.");if(parts.length!=4)return false;for(String x:parts){try{int n=Integer.parseInt(x);if(n<0||n>255||!String.valueOf(n).equals(x))return false;}catch(Exception e){return false;}}return true;}
    private void scanQr(){try{ScanOptions options=new ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt("Scan the RemoteDeck QR on your Windows PC").setBeepEnabled(false).setOrientationLocked(false);qrScanner.launch(options);}catch(Exception e){setHomeStatus("Could not start the QR scanner. Check camera permission and try again.",Color.rgb(255,138,114));}}
    private void pairFromQr(String raw){
        final String host;final int port;final String code;
        try{JSONObject p=new JSONObject(raw.trim());if(!"remote-media-control-pairing".equals(p.optString("type"))||p.optInt("version")!=1)throw new IllegalArgumentException("This is not a RemoteDeck pairing QR.");host=p.optString("host");if(!isIpv4Address(host))throw new IllegalArgumentException("The QR does not contain a valid PC IP address.");port=p.optInt("port");if(port<1||port>65535)throw new IllegalArgumentException("The QR contains an invalid port.");code=p.optString("pairing_code");if(!code.matches("[0-9]{6}"))throw new IllegalArgumentException("The QR is missing its six-digit pairing code.");}catch(Exception e){setHomeStatus(e.getMessage()==null?"Could not read the pairing QR.":e.getMessage(),Color.rgb(255,138,114));return;}
        setHomeStatus("Pairing with "+host+":"+port+"…",MUTED);
        new Thread(()->{
            HttpURLConnection c=null;String message=null;String token=null;
            try{URL u=new URL("http://"+host+":"+port+"/api/pair");c=(HttpURLConnection)u.openConnection();c.setRequestMethod("POST");c.setConnectTimeout(6000);c.setReadTimeout(6000);c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json; charset=utf-8");byte[] body=new JSONObject().put("pin",code).toString().getBytes(StandardCharsets.UTF_8);try(OutputStream out=c.getOutputStream()){out.write(body);}int status=c.getResponseCode();InputStream stream=status>=200&&status<300?c.getInputStream():c.getErrorStream();StringBuilder text=new StringBuilder();if(stream!=null){try(BufferedReader reader=new BufferedReader(new InputStreamReader(stream,StandardCharsets.UTF_8))){String line;while((line=reader.readLine())!=null)text.append(line);}}JSONObject response=new JSONObject(text.toString());if(status>=200&&status<300)token=response.optString("token",null);else message=response.optString("error","Pairing was rejected.");if(token==null||token.isEmpty())throw new IllegalStateException(message==null?"Windows did not return a pairing token.":message);}catch(Exception e){message=e instanceof java.net.ConnectException||e instanceof java.net.SocketTimeoutException?"Could not reach "+host+":"+port+". Check the Wi-Fi IP, port, and Windows Firewall.":(e.getMessage()==null?"Pairing failed.":e.getMessage());}finally{if(c!=null)c.disconnect();}
            final String saved=token,err=message;runOnUiThread(()->{if(saved!=null){getPreferences(MODE_PRIVATE).edit().putString("ip",host).putInt("port",port).apply();connect(host,port,saved);}else setHomeStatus(err,Color.rgb(255,138,114));});
        }).start();
    }
    private void connect(String host,int port,String token){
        connectedUrl="http://"+host+":"+port;android.content.SharedPreferences prefs=getPreferences(MODE_PRIVATE);android.content.SharedPreferences.Editor prefEdit=prefs.edit().putString("ip",host).putInt("port",port).putString("url",connectedUrl);if(token!=null)prefEdit.putString("pairToken",token);else if(!host.equals(prefs.getString("ip",""))||port!=prefs.getInt("port",8765))prefEdit.remove("pairToken");prefEdit.apply();
        root=column();root.setBackgroundColor(BG);setContentView(root);
        LinearLayout bar=new LinearLayout(this);bar.setGravity(Gravity.CENTER_VERTICAL);bar.setPadding(dp(17),0,dp(12),0);bar.setBackgroundColor(BG);
        TextView name=text("REMOTE / DECK",12,LIME,true);name.setLetterSpacing(.08f);bar.addView(name,new LinearLayout.LayoutParams(0,dp(52),1));
        TextView change=text("CHANGE PC",10,MUTED,true);change.setPadding(dp(12),dp(12),dp(5),dp(12));change.setOnClickListener(v->{if(web!=null){web.stopLoading();web.destroy();web=null;}showConnect();});bar.addView(change);root.addView(bar,params(-1,dp(52)));
        webFrame=new FrameLayout(this);root.addView(webFrame,new LinearLayout.LayoutParams(-1,0,1));
        web=new WebView(this);web.setBackgroundColor(BG);WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setLoadsImagesAutomatically(true);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebViewClient(new WebViewClient(){
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap favicon){loadFailed=false;showWait("Connecting…","Reaching "+connectedUrl);}
            @Override public void onPageFinished(WebView view,String url){if(!loadFailed&&waitCard!=null)waitCard.setVisibility(View.GONE);}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame()){loadFailed=true;showWait("Could not reach your PC","Check that the phone and PC are on the same Wi-Fi. Use the Wi-Fi IP and port shown in the Windows tray, and allow the listener through Windows Firewall.");}}
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,android.webkit.WebResourceResponse response){if(request.isForMainFrame()&&response.getStatusCode()>=400){loadFailed=true;showWait("Windows returned an error","The listener responded with error "+response.getStatusCode()+". Try again or change the PC address.");}}
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,android.net.http.SslError error){handler.cancel();loadFailed=true;showWait("Secure connection failed","Check the PC address and try again.");}
        });webFrame.addView(web,new FrameLayout.LayoutParams(-1,-1));
        buildWaitCard();String target=connectedUrl+(token==null?"":"/?pair_token="+Uri.encode(token));web.loadUrl(target);
    }
    private void buildWaitCard(){
        waitCard=column();waitCard.setGravity(Gravity.CENTER);waitCard.setPadding(dp(25),dp(26),dp(25),dp(26));waitCard.setBackground(shape(BG,Color.rgb(42,48,64),18));
        waitTitle=text("Connecting…",20,TEXT,true);waitTitle.setGravity(Gravity.CENTER);waitCard.addView(waitTitle,params(-1,-2));
        waitMessage=text("Reaching "+connectedUrl,14,MUTED,false);waitMessage.setGravity(Gravity.CENTER);waitMessage.setLineSpacing(dp(4),1f);LinearLayout.LayoutParams mp=params(-1,-2);mp.topMargin=dp(10);waitCard.addView(waitMessage,mp);
        Button retry=new Button(this);retry.setText("Retry");retry.setAllCaps(false);retry.setTextColor(Color.rgb(19,24,11));retry.setBackground(shape(LIME,0,10));LinearLayout.LayoutParams rp=params(-1,dp(46));rp.topMargin=dp(17);waitCard.addView(retry,rp);retry.setOnClickListener(v->{if(web!=null)web.reload();});
        Button change=new Button(this);change.setText("Change IP / port");change.setAllCaps(false);change.setTextColor(TEXT);change.setBackground(shape(PANEL,Color.rgb(42,48,64),10));LinearLayout.LayoutParams cp=params(-1,dp(44));cp.topMargin=dp(8);waitCard.addView(change,cp);change.setOnClickListener(v->{if(web!=null){web.stopLoading();web.destroy();web=null;}showConnect();});
        FrameLayout.LayoutParams fp=new FrameLayout.LayoutParams(-1,-2,Gravity.CENTER);fp.setMargins(dp(25),dp(20),dp(25),dp(20));webFrame.addView(waitCard,fp);
    }
    private void showWait(String title,String message){if(waitCard==null||webFrame==null)return;if(waitCard.getParent()==null)buildWaitCard();waitTitle.setText(title);waitMessage.setText(message);waitCard.setVisibility(View.VISIBLE);}
    @Override public void onBackPressed(){if(web!=null&&web.canGoBack())web.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){if(web!=null){web.destroy();web=null;}super.onDestroy();}
}

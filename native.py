import os, glob, json, math, wave, struct
from PIL import Image, ImageDraw

R = 'android/app/src/main/res/'
APP_ID = json.load(open('capacitor.config.json'))['appId']
JAVA_DIR = 'android/app/src/main/java/' + APP_ID.replace('.', '/') + '/'

def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)

# ---- black splash + launcher background ----
for f in glob.glob(R + '**/splash.png', recursive=True): os.remove(f)
write(R + 'drawable/splash.xml', '<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android"><solid android:color="#000000"/></shape>\n')
write(R + 'values/ic_launcher_background.xml', '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#000000</color>\n</resources>\n')

# ---- theme: black status & navigation bars ----
p = R + 'values/styles.xml'; s = open(p).read()
s = s.replace('<item name="android:background">@null</item>', '<item name="android:background">@null</item>\n        <item name="android:statusBarColor">#000000</item>\n        <item name="android:navigationBarColor">#000000</item>\n        <item name="android:windowBackground">#000000</item>')
open(p, 'w').write(s)

# ---- manifest: permissions + home-screen widgets ----
p = 'android/app/src/main/AndroidManifest.xml'; s = open(p).read()
s = s.replace('<uses-permission android:name="android.permission.INTERNET" />', '''<uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.USE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" android:maxSdkVersion="32" />''')

def receiver(cls, label, info):
    return f'''
        <receiver android:name="{APP_ID}.{cls}" android:exported="true" android:label="@string/{label}">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/{info}" />
        </receiver>
'''
widgets_xml = receiver('AnalogWidget', 'widget_analog_name', 'widget_analog_info') \
            + receiver('DigitalWidget', 'widget_digital_name', 'widget_digital_info') \
            + receiver('FlipWidget', 'widget_flip_name', 'widget_flip_info')
assert '</application>' in s
s = s.replace('</application>', widgets_xml + '    </application>', 1)
open(p, 'w').write(s)

# ---- launcher icons from the PWA icon ----
src = Image.open('www/icons/icon-512.png').convert('RGB')
fg = Image.open('www/icons/maskable-512.png').convert('RGB')
for d, legacy, adaptive in [('mdpi',48,108),('hdpi',72,162),('xhdpi',96,216),('xxhdpi',144,324),('xxxhdpi',192,432)]:
    a = src.resize((legacy, legacy), Image.LANCZOS)
    a.save(f'{R}mipmap-{d}/ic_launcher.png')
    m = Image.new('L', (legacy, legacy), 0); ImageDraw.Draw(m).ellipse([0,0,legacy-1,legacy-1], fill=255)
    r = a.copy(); r.putalpha(m); r.save(f'{R}mipmap-{d}/ic_launcher_round.png')
    fg.resize((adaptive, adaptive), Image.LANCZOS).save(f'{R}mipmap-{d}/ic_launcher_foreground.png')

# ---- alarm ringtone (60 s of repeating two-tone beeps, played by the alarm notification channel) ----
RATE = 16000
def tone(freq, dur):
    n = int(RATE * dur); out = []
    for i in range(n):
        env = min(1.0, i / (RATE * 0.008), (n - i) / (RATE * 0.02))
        out.append(0.8 * env * math.sin(2 * math.pi * freq * i / RATE))
    return out
def silence(dur): return [0.0] * int(RATE * dur)
unit = []
for _ in range(2):                       # beep-beep ... beep-beep
    unit += tone(1046.5, 0.14) + silence(0.07) + tone(1396.9, 0.14) + silence(0.07)
unit += silence(0.45)
samples = []
while len(samples) < RATE * 60: samples += unit
samples = samples[:RATE * 60]
os.makedirs(R + 'raw', exist_ok=True)
with wave.open(R + 'raw/alarm_sound.wav', 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
    w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, v)) * 30000)) for v in samples))

# ---- small notification icon ----
write(R + 'drawable/ic_stat_alarm.xml', '''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:pathData="M11.99,2C6.47,2 2,6.48 2,12s4.47,10 9.99,10C17.52,22 22,17.52 22,12S17.52,2 11.99,2zM12,20c-4.42,0 -8,-3.58 -8,-8s3.58,-8 8,-8 8,3.58 8,8 -3.58,8 -8,8zM12.5,7H11v6l5.25,3.15 0.75,-1.23 -4.5,-2.67z"/>
</vector>
''')

# ================= HOME-SCREEN WIDGETS (long-press the app icon -> Widgets) =================
write(R + 'values/widget_strings.xml', '''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="widget_analog_name">Analog Clock</string>
    <string name="widget_digital_name">Digital Clock</string>
    <string name="widget_flip_name">Flip Clock</string>
    <string name="widget_analog_desc">Resizable analog clock</string>
    <string name="widget_digital_desc">Resizable digital clock with date</string>
    <string name="widget_flip_desc">Resizable flip clock with date</string>
</resources>
''')

write(R + 'drawable/widget_bg.xml', '''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#F2000000"/>
    <stroke android:width="1dp" android:color="#33FFFFFF"/>
    <corners android:radius="26dp"/>
</shape>
''')
write(R + 'drawable/widget_flip_card.xml', '''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#161616"/>
    <stroke android:width="1dp" android:color="#2AFFFFFF"/>
    <corners android:radius="14dp"/>
</shape>
''')

# analog dial + hands (vector, 480dp so the clock only ever scales DOWN to the widget size)
ticks = ''
for i in range(60):
    hr = i % 5 == 0
    r1, r2 = (82, 92) if hr else (88, 92)
    a = math.radians(i * 6)
    x1, y1 = 100 + r1 * math.sin(a), 100 - r1 * math.cos(a)
    x2, y2 = 100 + r2 * math.sin(a), 100 - r2 * math.cos(a)
    col, wd = ('#FFFFFF', 3.4) if hr else ('#777777', 1.4)
    ticks += f'    <path android:pathData="M{x1:.2f},{y1:.2f} L{x2:.2f},{y2:.2f}" android:strokeColor="{col}" android:strokeWidth="{wd}" android:strokeLineCap="round"/>\n'
write(R + 'drawable/widget_dial.xml', f'''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="480dp" android:height="480dp" android:viewportWidth="200" android:viewportHeight="200">
    <path android:fillColor="#0A0A0A" android:strokeColor="#3A3A3A" android:strokeWidth="2" android:pathData="M100,100 m-96,0 a96,96 0 1,0 192,0 a96,96 0 1,0 -192,0"/>
{ticks}</vector>
''')
def hand(name, length, width):
    write(R + f'drawable/{name}.xml', f'''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="480dp" android:height="480dp" android:viewportWidth="200" android:viewportHeight="200">
    <path android:strokeColor="#FFFFFF" android:strokeWidth="{width}" android:strokeLineCap="round" android:pathData="M100,108 L100,{100 - length}"/>
    <path android:fillColor="#FFFFFF" android:pathData="M100,100 m-6,0 a6,6 0 1,0 12,0 a6,6 0 1,0 -12,0"/>
</vector>
''')
hand('widget_hand_hour', 48, 6)
hand('widget_hand_minute', 70, 4)

write(R + 'layout/widget_analog.xml', '''<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@drawable/widget_bg"
    android:padding="10dp">
    <AnalogClock
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:dial="@drawable/widget_dial"
        android:hand_hour="@drawable/widget_hand_hour"
        android:hand_minute="@drawable/widget_hand_minute" />
</FrameLayout>
''')

write(R + 'layout/widget_digital.xml', '''<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@drawable/widget_bg"
    android:orientation="vertical"
    android:gravity="center"
    android:paddingLeft="14dp"
    android:paddingRight="14dp"
    android:paddingTop="10dp"
    android:paddingBottom="10dp">
    <TextClock
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:gravity="center"
        android:format12Hour="h:mm"
        android:format24Hour="HH:mm"
        android:includeFontPadding="false"
        android:maxLines="1"
        android:textColor="#FFFFFF"
        android:textStyle="bold"
        android:fontFamily="sans-serif-medium"
        android:textSize="48sp"
        android:autoSizeTextType="uniform"
        android:autoSizeMinTextSize="16sp"
        android:autoSizeMaxTextSize="120sp"
        android:autoSizeStepGranularity="2sp" />
    <TextClock
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:gravity="center"
        android:format12Hour="EEE, MMM d  |  a"
        android:format24Hour="EEE, MMM d"
        android:maxLines="1"
        android:textColor="#A3A3A3"
        android:textSize="13sp" />
</LinearLayout>
''')

def card(fmt12, fmt24):
    return f'''        <FrameLayout
            android:layout_width="0dp"
            android:layout_height="match_parent"
            android:layout_weight="1"
            android:background="@drawable/widget_flip_card">
            <TextClock
                android:layout_width="match_parent"
                android:layout_height="match_parent"
                android:gravity="center"
                android:format12Hour="{fmt12}"
                android:format24Hour="{fmt24}"
                android:includeFontPadding="false"
                android:maxLines="1"
                android:padding="6dp"
                android:textColor="#FFFFFF"
                android:textStyle="bold"
                android:fontFamily="monospace"
                android:textSize="48sp"
                android:autoSizeTextType="uniform"
                android:autoSizeMinTextSize="14sp"
                android:autoSizeMaxTextSize="110sp"
                android:autoSizeStepGranularity="2sp" />
            <View
                android:layout_width="match_parent"
                android:layout_height="2dp"
                android:layout_gravity="center_vertical"
                android:background="#000000" />
        </FrameLayout>
'''
write(R + 'layout/widget_flip.xml', '''<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@drawable/widget_bg"
    android:orientation="vertical"
    android:padding="10dp">
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:orientation="horizontal">
''' + card('hh', 'HH') + '''        <View
            android:layout_width="8dp"
            android:layout_height="match_parent" />
''' + card('mm', 'mm') + '''    </LinearLayout>
    <TextClock
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="6dp"
        android:gravity="center"
        android:format12Hour="a  |  EEE, MMM d"
        android:format24Hour="EEE, MMM d"
        android:maxLines="1"
        android:textColor="#A3A3A3"
        android:textSize="12sp" />
</LinearLayout>
''')

def info(layout, desc, minw, minh, cw, ch):
    return f'''<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="{minw}dp"
    android:minHeight="{minh}dp"
    android:minResizeWidth="60dp"
    android:minResizeHeight="60dp"
    android:targetCellWidth="{cw}"
    android:targetCellHeight="{ch}"
    android:updatePeriodMillis="0"
    android:initialLayout="@layout/{layout}"
    android:previewLayout="@layout/{layout}"
    android:resizeMode="horizontal|vertical"
    android:widgetCategory="home_screen"
    android:description="@string/{desc}" />
'''
write(R + 'xml/widget_analog_info.xml', info('widget_analog', 'widget_analog_desc', 110, 110, 2, 2))
write(R + 'xml/widget_digital_info.xml', info('widget_digital', 'widget_digital_desc', 180, 110, 4, 2))
write(R + 'xml/widget_flip_info.xml', info('widget_flip', 'widget_flip_desc', 180, 110, 4, 2))

write(JAVA_DIR + 'BaseClockWidget.java', f'''package {APP_ID};

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** Clock widgets use self-updating AnalogClock / TextClock views; tapping a widget opens the app. */
public abstract class BaseClockWidget extends AppWidgetProvider {{
    protected abstract int layoutId();

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {{
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent pi = null;
        if (launch != null) {{
            pi = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }}
        for (int id : appWidgetIds) {{
            RemoteViews views = new RemoteViews(context.getPackageName(), layoutId());
            if (pi != null) {{
                views.setOnClickPendingIntent(R.id.widget_root, pi);
            }}
            manager.updateAppWidget(id, views);
        }}
    }}
}}
''')
for cls, lay in [('AnalogWidget', 'widget_analog'), ('DigitalWidget', 'widget_digital'), ('FlipWidget', 'widget_flip')]:
    write(JAVA_DIR + cls + '.java', f'''package {APP_ID};

public class {cls} extends BaseClockWidget {{
    @Override
    protected int layoutId() {{
        return R.layout.{lay};
    }}
}}
''')
print('native.py: done')

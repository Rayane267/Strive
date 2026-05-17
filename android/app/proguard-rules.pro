# Add project specific ProGuard rules here.

# ─── React Native core ────────────────────────────────────────────────────────
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-dontwarn com.facebook.**

# Hermes intl
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }

# ─── ML Kit Text Recognition ──────────────────────────────────────────────────
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_text_common.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_text_latin.** { *; }
-dontwarn com.google.mlkit.**

# ─── Strive native modules (bridge → JS) ──────────────────────────────────────
-keep class com.strive.scanner.** { *; }
-keep class com.strive.scanner.OcrParser$* { *; }
-keep class com.strive.scanner.GeminiVisionService$* { *; }
-keep class com.strive.scanner.TomTomService$* { *; }
-keepclassmembers class com.strive.scanner.** {
    @com.facebook.react.bridge.ReactMethod *;
}
# Préserve les Runnable / lambdas captées par Thread{} et postDelayed
-keepclassmembers class * implements java.lang.Runnable {
    void run();
}

# ─── OkHttp / Retrofit / Okio (utilisés par Supabase, TomTom, Gemini) ─────────
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn javax.annotation.**

# ─── Google Play Services (Google Sign-In, FCM) ───────────────────────────────
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# ─── Firebase (Messaging, Core) ───────────────────────────────────────────────
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.tasks.** { *; }
-dontwarn com.google.firebase.**

# ─── Google Sign-In ───────────────────────────────────────────────────────────
-keep class com.reactnativegooglesignin.** { *; }
-dontwarn com.reactnativegooglesignin.**

# ─── Apple Authentication (invertase) ─────────────────────────────────────────
-keep class com.RNAppleAuthentication.** { *; }
-dontwarn com.RNAppleAuthentication.**

# ─── Sentry ───────────────────────────────────────────────────────────────────
-keep class io.sentry.** { *; }
-dontwarn io.sentry.**
-keepattributes LineNumberTable,SourceFile
-renamesourcefileattribute SourceFile

# ─── RevenueCat ───────────────────────────────────────────────────────────────
-keep class com.revenuecat.purchases.** { *; }
-dontwarn com.revenuecat.purchases.**

# ─── react-native-reanimated ──────────────────────────────────────────────────
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# ─── react-native-svg ─────────────────────────────────────────────────────────
-keep public class com.horcrux.svg.** {*;}

# ─── react-native-vector-icons ────────────────────────────────────────────────
-keep class com.oblador.vectoricons.** { *; }

# ─── AsyncStorage ─────────────────────────────────────────────────────────────
-keep class com.reactnativecommunity.asyncstorage.** { *; }

# ─── NetInfo ──────────────────────────────────────────────────────────────────
-keep class com.reactnativecommunity.netinfo.** { *; }

# ─── JSON / Reflection (Gson/Moshi utilisés indirectement) ────────────────────
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes InnerClasses,EnclosingMethod
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# ─── Keep enums (évite que R8 casse leur serialization) ───────────────────────
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# ─── Keep BuildConfig ─────────────────────────────────────────────────────────
-keep class com.strive.BuildConfig { *; }

# ─── Keep parcelables ─────────────────────────────────────────────────────────
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator CREATOR;
}

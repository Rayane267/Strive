# Add project specific ProGuard rules here.

# React Native
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-dontwarn com.facebook.**

# ML Kit
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**

# Strive scanner — NativeModules bridge
-keep class com.strive.scanner.** { *; }

# Supabase / OkHttp / Retrofit
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**

# Google Play Services
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# RevenueCat
-keep class com.revenuecat.purchases.** { *; }

# Keep BuildConfig
-keep class com.strive.BuildConfig { *; }

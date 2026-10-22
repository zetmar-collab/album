# ML Kit rejestruje swoje komponenty przez refleksje (MlKitContext.get(...)) -
# bez tych regul R8 usuwa je i skaner kodow zwraca null (crash tylko w wydaniu).
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_** { *; }
-keep class * implements com.google.firebase.components.ComponentRegistrar { *; }

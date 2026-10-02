# kotlinx.serialization: keep generated serializers and companions for @Serializable classes.
# (The library ships consumer rules too; these make the app's own models explicit.)
-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod
-dontnote kotlinx.serialization.**

-keepclassmembers @kotlinx.serialization.Serializable class com.stephensookra.atlas.** {
    *** Companion;
    *** INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclasseswithmembers class com.stephensookra.atlas.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.stephensookra.atlas.**$$serializer { *; }
-keepnames @kotlinx.serialization.Serializable class com.stephensookra.atlas.**

# Sealed polymorphic ResourceCard: subclass names are read through @SerialName, keep them.
-keep class com.stephensookra.atlas.data.ResourceCard$* { *; }

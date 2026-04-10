#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(ScanBridge, RCTEventEmitter)

RCT_EXTERN_METHOD(startScanner:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stopScanner:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isScannerRunning:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(checkPermissions:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(showVerdict:(nonnull NSNumber *)level)

RCT_EXTERN_METHOD(updateDuration:(nonnull NSNumber *)minutes)

RCT_EXTERN_METHOD(setGeminiApiKey:(NSString *)key)

RCT_EXTERN_METHOD(setGeminiConfig:(NSString *)edgeUrl
                  supabaseAnonKey:(NSString *)supabaseAnonKey)

RCT_EXTERN_METHOD(setParserConfig:(NSString *)configJson)

RCT_EXTERN_METHOD(openOverlayPermissionSettings)

RCT_EXTERN_METHOD(openAccessibilitySettings)

RCT_EXTERN_METHOD(requestMediaProjectionPermission:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(analyzeImage:(NSString *)imageUri
                  resolve:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end

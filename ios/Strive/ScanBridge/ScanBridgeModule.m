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

RCT_EXTERN_METHOD(setGeminiConfig:(NSString *)edgeUrl
                  supabaseAnonKey:(NSString *)supabaseAnonKey)

RCT_EXTERN_METHOD(setSupabaseUserJwt:(NSString *)jwt)

RCT_EXTERN_METHOD(setParserConfig:(NSString *)configJson)

RCT_EXTERN_METHOD(setTomTomApiKey:(NSString *)key)

RCT_EXTERN_METHOD(setQuotaReached:(BOOL)reached)

RCT_EXTERN_METHOD(updateSessionKPI:(NSDictionary *)payload)

RCT_EXTERN_METHOD(setUseLiveActivity:(BOOL)enabled)

RCT_EXTERN_METHOD(setScannerPreferences:(nonnull NSNumber *)minHourlyRate
                  minKmRate:(nonnull NSNumber *)minKmRate
                  includePickup:(BOOL)includePickup)

RCT_EXTERN_METHOD(openOverlayPermissionSettings)

RCT_EXTERN_METHOD(openAccessibilitySettings)

RCT_EXTERN_METHOD(requestMediaProjectionPermission:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(analyzeImage:(NSString *)imageUri
                  resolve:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startLiveActivity:(NSDictionary *)payload
                  resolve:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(updateLiveActivity:(NSDictionary *)payload
                  resolve:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stopLiveActivity:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(scheduleLocalNotification:(NSString *)identifier
                  title:(NSString *)title
                  body:(NSString *)body
                  delaySeconds:(double)delaySeconds)

RCT_EXTERN_METHOD(cancelLocalNotification:(NSString *)identifier)

@end

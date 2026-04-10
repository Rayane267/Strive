import Foundation
import UIKit
import React

/// Module natif React Native — pont entre JS et le scanner iOS.
/// Équivalent de ScanBridgeModule.kt sur Android.
@objc(ScanBridge)
class ScanBridgeModule: RCTEventEmitter {

  private var isActive = false
  private var hasListeners = false

  // MARK: - App Group (partage données avec Share Extension)

  static let appGroupId = "group.com.strive.app"
  static let scanResultKey = "lastScanResult"
  static let scanTimestampKey = "lastScanTimestamp"

  // MARK: - RCTEventEmitter

  override static func moduleName() -> String! {
    return "ScanBridge"
  }

  @objc override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String]! {
    return ["onScanResult", "onScanFailed", "onPermissionDenied"]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  // MARK: - Lifecycle

  override init() {
    super.init()
    // Écouter les résultats de la Share Extension via Darwin notification
    let center = CFNotificationCenterGetDarwinNotifyCenter()
    let observer = Unmanaged.passUnretained(self).toOpaque()
    CFNotificationCenterAddObserver(
      center,
      observer,
      { _, observer, _, _, _ in
        guard let observer = observer else { return }
        let module = Unmanaged<ScanBridgeModule>.fromOpaque(observer).takeUnretainedValue()
        DispatchQueue.main.async {
          module.handleShareExtensionResult()
        }
      },
      "com.strive.app.scanResult" as CFString,
      nil,
      .deliverImmediately
    )

    // Aussi écouter quand l'app revient au premier plan (au cas où la notification Darwin est manquée)
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(appDidBecomeActive),
      name: UIApplication.didBecomeActiveNotification,
      object: nil
    )
  }

  deinit {
    let center = CFNotificationCenterGetDarwinNotifyCenter()
    CFNotificationCenterRemoveEveryObserver(center, Unmanaged.passUnretained(self).toOpaque())
    NotificationCenter.default.removeObserver(self)
  }

  @objc private func appDidBecomeActive() {
    if isActive {
      handleShareExtensionResult()
    }
  }

  // MARK: - Lecture résultat Share Extension

  private var lastProcessedTimestamp: Double = 0

  private func handleShareExtensionResult() {
    guard hasListeners else { return }
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }

    let timestamp = defaults.double(forKey: Self.scanTimestampKey)
    guard timestamp > lastProcessedTimestamp else { return }
    lastProcessedTimestamp = timestamp

    guard let jsonData = defaults.data(forKey: Self.scanResultKey),
          let result = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any]
    else {
      sendEvent(withName: "onScanFailed", body: nil)
      return
    }

    // Nettoyer après lecture
    defaults.removeObject(forKey: Self.scanResultKey)
    defaults.removeObject(forKey: Self.scanTimestampKey)

    sendEvent(withName: "onScanResult", body: result)
  }

  // MARK: - Bridge Methods (appelées depuis JS)

  @objc func startScanner(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
    isActive = true
    // Vérifier s'il y a un résultat en attente
    handleShareExtensionResult()
    resolve(nil)
  }

  @objc func stopScanner(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
    isActive = false
    resolve(nil)
  }

  @objc func isScannerRunning(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(isActive)
  }

  @objc func checkPermissions(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
    // iOS n'a pas besoin d'overlay ni d'accessibility
    // On vérifie juste que la Share Extension est configurée
    let extensionConfigured = UserDefaults(suiteName: Self.appGroupId) != nil
    resolve([
      "overlay": true,                    // pas nécessaire sur iOS
      "accessibility": true,              // pas nécessaire sur iOS
      "needsMediaProjection": false,
      "mediaProjectionGranted": true,
      "shareExtensionReady": extensionConfigured,
    ])
  }

  @objc func showVerdict(_ level: NSNumber) {
    // Sur iOS, le verdict est affiché dans la Share Extension directement
    // On stocke quand même pour que l'extension puisse le récupérer
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }
    defaults.set(level.intValue, forKey: "lastVerdictLevel")
  }

  @objc func updateDuration(_ minutes: NSNumber) {
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }
    defaults.set(minutes.intValue, forKey: "lastDurationMin")
  }

  @objc func setGeminiApiKey(_ key: String) {
    GeminiVisionService.shared.apiKey = key
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(key, forKey: "geminiApiKey")
    }
  }

  @objc func setGeminiConfig(_ edgeUrl: String, supabaseAnonKey: String) {
    GeminiVisionService.shared.edgeFunctionUrl = edgeUrl
    GeminiVisionService.shared.supabaseAnonKey = supabaseAnonKey
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(edgeUrl, forKey: "geminiEdgeUrl")
      defaults.set(supabaseAnonKey, forKey: "geminiSupabaseKey")
    }
  }

  @objc func setParserConfig(_ configJson: String) {
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(configJson, forKey: "parserConfig")
    }
  }

  @objc func openOverlayPermissionSettings() {
    // No-op sur iOS — pas de permission overlay
  }

  @objc func openAccessibilitySettings() {
    // No-op sur iOS — pas de permission accessibility
  }

  @objc func requestMediaProjectionPermission(_ resolve: @escaping RCTPromiseResolveBlock,
                                              rejecter reject: @escaping RCTPromiseRejectBlock) {
    // No-op sur iOS
    resolve(nil)
  }

  /// Analyse une image directement depuis l'app (ex: depuis la galerie photo)
  @objc func analyzeImage(_ imageUri: String,
                          resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let url = URL(string: imageUri),
          let data = try? Data(contentsOf: url),
          let image = UIImage(data: data)
    else {
      reject("INVALID_IMAGE", "Impossible de charger l'image", nil)
      return
    }

    VisionOCRService.shared.recognizeText(from: image) { [weak self] ocrResult in
      guard let ocrResult = ocrResult, !ocrResult.blocks.isEmpty else {
        // Fallback Gemini
        GeminiVisionService.shared.analyze(image: image) { geminiResult in
          guard let geminiResult = geminiResult else {
            reject("OCR_FAILED", "Échec de l'analyse OCR et Gemini", nil)
            return
          }
          let body: [String: Any] = [
            "platform": geminiResult.platform,
            "fare": geminiResult.fare,
            "distanceKm": geminiResult.distanceKm,
            "durationMin": geminiResult.durationMin as Any,
          ]
          resolve(body)
        }
        return
      }

      // Envoyer les blocs au JS pour parsing par ocrParser.ts
      let blocks = ocrResult.blocks.map { $0.toDictionary() }
      resolve([
        "blocks": blocks,
        "screenHeight": ocrResult.screenHeight,
      ])
    }
  }
}

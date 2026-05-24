import Foundation
import ActivityKit
import UIKit

// Sentry n'est linké que dans le target principal (via RNSentry).
// `canImport` permet à ce fichier de rester compilable depuis la Share
// Extension où Sentry n'est pas dispo : les calls deviennent no-ops là-bas.
#if canImport(Sentry)
import Sentry
#endif

/// Gestionnaire Live Activity Strive — démarre, met à jour et termine l'activité
/// affichée dans la Dynamic Island et le Lock Screen pendant un scan.
///
/// Une seule activité active à la fois : si un nouveau scan arrive pendant
/// qu'une activité tourne, on la termine avant de démarrer la suivante.
@available(iOS 16.2, *)
final class LiveActivityManager {

  static let shared = LiveActivityManager()
  private init() {}

  private var current: Activity<StriveActivityAttributes>?

  /// Démarre une nouvelle Live Activity avec les valeurs fournies.
  /// Renvoie `false` si l'utilisateur a refusé les Live Activities (réglages iOS).
  @discardableResult
  func start(
    platform: String,
    fare: Double,
    hourlyRate: Double,
    kmRate: Double,
    distanceKm: Double,
    durationMin: Int,
    verdictLevel: Int
  ) -> Bool {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else {
      NSLog("[Strive] LiveActivity disabled — Settings → Strive → Live Activities OFF")
      #if canImport(Sentry)
      SentrySDK.capture(message: "LiveActivity not started: areActivitiesEnabled=false") { scope in
        scope.setLevel(.warning)
        scope.setTag(value: "live-activity", key: "feature")
        scope.setTag(value: "auth-disabled", key: "reason")
      }
      #endif
      return false
    }

    // Termine l'activité précédente si elle existe.
    if let current = current {
      Task { await current.end(nil, dismissalPolicy: .immediate) }
    }

    let attributes = StriveActivityAttributes()
    let state = StriveActivityAttributes.State(
      platform: platform,
      fare: fare,
      hourlyRate: hourlyRate,
      kmRate: kmRate,
      distanceKm: distanceKm,
      durationMin: durationMin,
      verdictLevel: verdictLevel
    )

    do {
      let content = ActivityContent(
        state: state,
        // Auto-dismiss après 30s si non terminé manuellement.
        staleDate: Date().addingTimeInterval(30)
      )
      current = try Activity.request(
        attributes: attributes,
        content: content,
        pushType: nil
      )
      #if canImport(Sentry)
      SentrySDK.addBreadcrumb({
        let b = Breadcrumb(level: .info, category: "live-activity")
        b.message = "started"
        b.data = [
          "platform": platform,
          "fare": fare,
          "hourlyRate": hourlyRate,
          "verdictLevel": verdictLevel,
        ]
        return b
      }())
      #endif
      return true
    } catch {
      NSLog("[Strive] LiveActivity start failed: \(error.localizedDescription)")
      #if canImport(Sentry)
      SentrySDK.capture(error: error) { scope in
        scope.setTag(value: "live-activity", key: "feature")
        scope.setTag(value: "activity-request-failed", key: "reason")
        scope.setContext(value: [
          "platform": platform,
          "verdictLevel": verdictLevel,
        ], key: "live-activity-payload")
      }
      #endif
      return false
    }
  }

  /// Met à jour l'activité courante (ex: TomTom a renvoyé la vraie distance).
  func update(
    platform: String,
    fare: Double,
    hourlyRate: Double,
    kmRate: Double,
    distanceKm: Double,
    durationMin: Int,
    verdictLevel: Int
  ) {
    guard let activity = current else { return }
    let state = StriveActivityAttributes.State(
      platform: platform,
      fare: fare,
      hourlyRate: hourlyRate,
      kmRate: kmRate,
      distanceKm: distanceKm,
      durationMin: durationMin,
      verdictLevel: verdictLevel
    )
    let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(30))
    Task { await activity.update(content) }
  }

  /// Termine immédiatement l'activité (ex: l'utilisateur a tapé sur Annuler).
  func stop() {
    guard let activity = current else { return }
    Task { await activity.end(nil, dismissalPolicy: .immediate) }
    current = nil
  }
}

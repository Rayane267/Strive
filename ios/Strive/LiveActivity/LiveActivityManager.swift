import Foundation
import ActivityKit
import UIKit

#if canImport(Sentry)
import Sentry
#endif

@available(iOS 16.2, *)
final class LiveActivityManager {

  static let shared = LiveActivityManager()
  private init() {}

  private var current: Activity<StriveActivityAttributes>?
  private var autoDismiss: DispatchWorkItem?

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
    let authInfo = ActivityAuthorizationInfo()
    NSLog("[Strive] LiveActivity areActivitiesEnabled=%d, platform=%@", authInfo.areActivitiesEnabled ? 1 : 0, platform)
    guard authInfo.areActivitiesEnabled else {
      NSLog("[Strive] LiveActivity disabled — Settings → Strive → Live Activities OFF")
      return false
    }

    if let current = current {
      Task { await current.end(nil, dismissalPolicy: .immediate) }
      self.current = nil
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
        staleDate: Date().addingTimeInterval(45)
      )
      current = try Activity.request(
        attributes: attributes,
        content: content,
        pushType: nil
      )
      NSLog("[Strive] LiveActivity started — platform=%@", platform)
      return true
    } catch {
      NSLog("[Strive] LiveActivity start FAILED: %@ (domain=%@, code=%d)",
            error.localizedDescription,
            (error as NSError).domain,
            (error as NSError).code)
      return false
    }
  }

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
    let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(10))
    Task { await activity.update(content) }

    autoDismiss?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.stop() }
    autoDismiss = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: work)
  }

  func stop() {
    autoDismiss?.cancel()
    autoDismiss = nil
    guard let activity = current else { return }
    Task { await activity.end(nil, dismissalPolicy: .immediate) }
    current = nil
  }
}

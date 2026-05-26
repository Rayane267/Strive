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
  private var pendingRetry: DispatchWorkItem?

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
    pendingRetry?.cancel()
    pendingRetry = nil

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

    return attemptRequest(attributes: attributes, state: state, retriesLeft: 5, delay: 0.5)
  }

  // MARK: - Retry logic

  @discardableResult
  private func attemptRequest(
    attributes: StriveActivityAttributes,
    state: StriveActivityAttributes.State,
    retriesLeft: Int,
    delay: TimeInterval
  ) -> Bool {
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
      NSLog("[Strive] LiveActivity started (retries remaining: %d)", retriesLeft)
      #if canImport(Sentry)
      SentrySDK.addBreadcrumb({
        let b = Breadcrumb(level: .info, category: "live-activity")
        b.message = "started"
        b.data = [
          "platform": state.platform,
          "fare": state.fare,
          "hourlyRate": state.hourlyRate,
          "verdictLevel": state.verdictLevel,
        ]
        return b
      }())
      #endif
      return true
    } catch let authError as ActivityAuthorizationError {
      if retriesLeft > 0 {
        NSLog("[Strive] LiveActivity visibility error — retrying in %.1fs (%d left)", delay, retriesLeft)
        let work = DispatchWorkItem { [weak self] in
          self?.attemptRequest(
            attributes: attributes,
            state: state,
            retriesLeft: retriesLeft - 1,
            delay: min(delay * 1.5, 2.5)
          )
        }
        pendingRetry = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
      } else {
        NSLog("[Strive] LiveActivity start failed after all retries: %@", authError.localizedDescription)
        #if canImport(Sentry)
        SentrySDK.capture(error: authError) { scope in
          scope.setTag(value: "live-activity", key: "feature")
          scope.setTag(value: "visibility-exhausted", key: "reason")
          scope.setContext(value: [
            "platform": state.platform,
            "verdictLevel": "\(state.verdictLevel)",
          ], key: "live-activity-payload")
        }
        #endif
      }
      return false
    } catch {
      NSLog("[Strive] LiveActivity start failed: %@", error.localizedDescription)
      #if canImport(Sentry)
      SentrySDK.capture(error: error) { scope in
        scope.setTag(value: "live-activity", key: "feature")
        scope.setTag(value: "activity-request-failed", key: "reason")
        scope.setContext(value: [
          "platform": state.platform,
          "verdictLevel": "\(state.verdictLevel)",
        ], key: "live-activity-payload")
      }
      #endif
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
    let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(45))
    Task { await activity.update(content) }
  }

  func stop() {
    pendingRetry?.cancel()
    pendingRetry = nil
    guard let activity = current else { return }
    Task { await activity.end(nil, dismissalPolicy: .immediate) }
    current = nil
  }
}

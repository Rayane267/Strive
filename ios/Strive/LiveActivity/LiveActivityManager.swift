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

  private static let appGroupId = "group.com.striveapp.app"

  private func log(_ msg: String) {
    NSLog("[Strive:LA] %@", msg)
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }
    var trace = defaults.string(forKey: "laSteps") ?? ""
    let fmt = DateFormatter()
    fmt.dateFormat = "HH:mm:ss.SSS"
    trace += "[\(fmt.string(from: Date()))] \(msg)\n"
    if trace.count > 2000 { trace = String(trace.suffix(2000)) }
    defaults.set(trace, forKey: "laSteps")
    defaults.set(msg, forKey: "laLastStep")
  }

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
    log("start(\(platform)) fare=\(fare) hr=\(hourlyRate) km=\(kmRate)")

    let existingCount = Activity<StriveActivityAttributes>.activities.count
    log("existing=\(existingCount) current=\(current == nil ? "nil" : current!.id)")

    if let current = current {
      log("ending previous \(current.id)")
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
        staleDate: Date().addingTimeInterval(3600 * 8)
      )
      log("calling Activity.request()...")
      current = try Activity.request(
        attributes: attributes,
        content: content,
        pushType: nil
      )
      log("OK id=\(current?.id ?? "nil")")
      return true
    } catch {
      log("FAILED: \(error.localizedDescription) domain=\((error as NSError).domain) code=\((error as NSError).code)")
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
    log("update(\(platform)) fare=\(fare) hr=\(hourlyRate)")
    if current == nil {
      current = Activity<StriveActivityAttributes>.activities.first
      log("recovered existing activity: \(current?.id ?? "none")")
    }
    guard let activity = current else {
      log("SKIP update — no activity running")
      return
    }
    let state = StriveActivityAttributes.State(
      platform: platform,
      fare: fare,
      hourlyRate: hourlyRate,
      kmRate: kmRate,
      distanceKm: distanceKm,
      durationMin: durationMin,
      verdictLevel: verdictLevel
    )
    let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(12))
    let alert = AlertConfiguration(title: "", body: "", sound: .default)
    Task { await activity.update(content, alertConfiguration: alert) }
    log("updated \(activity.id), dismiss in 10s")

    autoDismiss?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.backToIdle() }
    autoDismiss = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: work)
  }

  func backToIdle() {
    if current == nil {
      current = Activity<StriveActivityAttributes>.activities.first
    }
    guard let activity = current else { return }
    log("backToIdle")
    let idle = StriveActivityAttributes.State(
      platform: "IDLE",
      fare: 0, hourlyRate: 0, kmRate: 0,
      distanceKm: 0, durationMin: 0, verdictLevel: 1
    )
    let content = ActivityContent(state: idle, staleDate: Date().addingTimeInterval(3600 * 8))
    Task { await activity.update(content) }
  }

  func showError() {
    if current == nil {
      current = Activity<StriveActivityAttributes>.activities.first
    }
    guard let activity = current else {
      log("showError() — no activity, skip")
      return
    }
    log("showError() on \(activity.id)")
    let errorState = StriveActivityAttributes.State(
      platform: "ERROR",
      fare: 0, hourlyRate: 0, kmRate: 0,
      distanceKm: 0, durationMin: 0, verdictLevel: 0
    )
    let content = ActivityContent(state: errorState, staleDate: Date().addingTimeInterval(7))
    Task { await activity.update(content) }

    autoDismiss?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.backToIdle() }
    autoDismiss = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: work)
  }

  func stop() {
    log("stop() current=\(current == nil ? "nil" : current!.id)")
    autoDismiss?.cancel()
    autoDismiss = nil
    guard let activity = current else { return }
    Task { await activity.end(nil, dismissalPolicy: .immediate) }
    current = nil
  }
}

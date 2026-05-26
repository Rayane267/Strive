import SwiftUI
import WidgetKit
import ActivityKit

@available(iOS 16.2, *)
struct StriveLiveActivity: Widget {

  var body: some WidgetConfiguration {
    ActivityConfiguration(for: StriveActivityAttributes.self) { context in
      LockScreenView(state: context.state)
        .activityBackgroundTint(Color.black.opacity(0.92))
        .activitySystemActionForegroundColor(.white)

    } dynamicIsland: { context in
      let isScanning = context.state.platform == "SCANNING"
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          if isScanning {
            HStack(spacing: 6) {
              ProgressView()
                .tint(.white)
              Text("Analyse…")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.white.opacity(0.75))
            }
            .padding(.leading, 4)
          } else {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
              Text(context.state.platform.capitalized)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.white.opacity(0.75))
              HourlyRate(value: context.state.hourlyRate, level: context.state.verdictLevel)
            }
            .padding(.leading, 4)
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          if !isScanning {
            HStack(spacing: 8) {
              FarePill(fare: context.state.fare, level: context.state.verdictLevel)
              KmRateText(value: context.state.kmRate, level: context.state.verdictLevel)
            }
            .padding(.trailing, 4)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          if !isScanning {
            RouteRow(
              distanceKm: context.state.distanceKm,
              durationMin: context.state.durationMin,
              level: context.state.verdictLevel
            )
            .padding(.horizontal, 4)
            .padding(.top, 4)
          }
        }
      } compactLeading: {
        if isScanning {
          ProgressView()
            .tint(.white)
        } else {
          Image(systemName: "car.fill")
            .foregroundColor(verdictColor(context.state.verdictLevel))
        }
      } compactTrailing: {
        if isScanning {
          Text("…")
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(.white.opacity(0.6))
        } else {
          Text("€\(Int(context.state.hourlyRate))/h")
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(verdictColor(context.state.verdictLevel))
        }
      } minimal: {
        if isScanning {
          ProgressView()
            .tint(.white)
        } else {
          Image(systemName: verdictIcon(context.state.verdictLevel))
            .foregroundColor(verdictColor(context.state.verdictLevel))
        }
      }
      .keylineTint(isScanning ? .white : verdictColor(context.state.verdictLevel))
    }
  }
}

// MARK: - Lock Screen (banner haut quand pas de Dynamic Island)

@available(iOS 16.2, *)
private struct LockScreenView: View {
  let state: StriveActivityAttributes.ContentState

  var body: some View {
    let isScanning = state.platform == "SCANNING"
    VStack(spacing: 12) {
      if isScanning {
        HStack(spacing: 8) {
          ProgressView()
            .tint(.white)
          Text("Analyse en cours…")
            .font(.system(size: 15, weight: .semibold))
            .foregroundColor(.white.opacity(0.75))
        }
      } else {
        HStack(alignment: .center, spacing: 10) {
          Text(state.platform.capitalized)
            .font(.system(size: 15, weight: .semibold))
            .foregroundColor(.white.opacity(0.75))

          HourlyRate(value: state.hourlyRate, level: state.verdictLevel)

          Spacer(minLength: 6)

          FarePill(fare: state.fare, level: state.verdictLevel)

          KmRateText(value: state.kmRate, level: state.verdictLevel)
        }

        RouteRow(
          distanceKm: state.distanceKm,
          durationMin: state.durationMin,
          level: state.verdictLevel
        )
      }
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 12)
  }
}

// MARK: - Composants

@available(iOS 16.2, *)
private struct HourlyRate: View {
  let value: Double
  let level: Int
  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 2) {
      Text("€\(Int(value))")
        .font(.system(size: 26, weight: .heavy))
        .foregroundColor(.white)
      Text("/h")
        .font(.system(size: 13, weight: .semibold))
        .foregroundColor(.white.opacity(0.55))
    }
  }
}

@available(iOS 16.2, *)
private struct FarePill: View {
  let fare: Double
  let level: Int
  var body: some View {
    Text(String(format: "€%.0f", fare))
      .font(.system(size: 13, weight: .bold))
      .foregroundColor(.white)
      .padding(.horizontal, 10)
      .padding(.vertical, 4)
      .background(
        Capsule().fill(verdictColor(level).opacity(0.28))
      )
      .overlay(
        Capsule().stroke(verdictColor(level).opacity(0.85), lineWidth: 1)
      )
  }
}

@available(iOS 16.2, *)
private struct KmRateText: View {
  let value: Double
  let level: Int
  var body: some View {
    HStack(spacing: 3) {
      Image(systemName: "arrow.up.right")
        .font(.system(size: 11, weight: .heavy))
        .foregroundColor(verdictColor(level))
      Text(String(format: "€%.2f/km", value))
        .font(.system(size: 13, weight: .semibold))
        .foregroundColor(.white)
    }
  }
}

@available(iOS 16.2, *)
private struct RouteRow: View {
  let distanceKm: Double
  let durationMin: Int
  let level: Int

  var body: some View {
    HStack(alignment: .center, spacing: 10) {
      ZStack {
        Circle()
          .fill(verdictColor(level))
          .frame(width: 26, height: 26)
        Image(systemName: "car.fill")
          .font(.system(size: 12, weight: .bold))
          .foregroundColor(.black)
      }

      ZStack {
        Capsule()
          .fill(verdictColor(level).opacity(0.85))
          .frame(height: 3)
        Circle()
          .fill(verdictColor(level))
          .frame(width: 10, height: 10)
      }

      VStack(alignment: .trailing, spacing: 1) {
        Text("\(durationMin)min")
          .font(.system(size: 14, weight: .bold))
          .foregroundColor(.white)
        Text(String(format: "%.1fkm", distanceKm))
          .font(.system(size: 11, weight: .semibold))
          .foregroundColor(.white.opacity(0.55))
      }

      ZStack {
        Circle()
          .fill(verdictColor(level))
          .frame(width: 26, height: 26)
        Image(systemName: verdictIcon(level))
          .font(.system(size: 12, weight: .bold))
          .foregroundColor(.black)
      }
    }
  }
}

// MARK: - Helpers couleurs

@available(iOS 16.2, *)
private func verdictColor(_ level: Int) -> Color {
  switch level {
  case 2: return Color(red: 0.0, green: 0.78, blue: 0.32)
  case 1: return Color(red: 1.0, green: 0.60, blue: 0.0)
  default: return Color(red: 0.94, green: 0.27, blue: 0.27)
  }
}

@available(iOS 16.2, *)
private func verdictIcon(_ level: Int) -> String {
  switch level {
  case 2: return "checkmark"
  case 1: return "exclamationmark"
  default: return "xmark"
  }
}

// MARK: - Previews (Xcode Canvas)

@available(iOS 17.0, *)
#Preview("Lock Screen — Vert (rentable)", as: .content, using: StriveActivityAttributes()) {
  StriveLiveActivity()
} contentStates: {
  StriveActivityAttributes.ContentState(
    platform: "UBER",
    fare: 24.0,
    hourlyRate: 37,
    kmRate: 1.52,
    distanceKm: 12.6,
    durationMin: 29,
    verdictLevel: 2
  )
}

@available(iOS 17.0, *)
#Preview("Lock Screen — Orange (limite)", as: .content, using: StriveActivityAttributes()) {
  StriveLiveActivity()
} contentStates: {
  StriveActivityAttributes.ContentState(
    platform: "BOLT",
    fare: 12.0,
    hourlyRate: 22,
    kmRate: 0.97,
    distanceKm: 8.4,
    durationMin: 17,
    verdictLevel: 1
  )
}

@available(iOS 17.0, *)
#Preview("Lock Screen — Rouge (refuse)", as: .content, using: StriveActivityAttributes()) {
  StriveLiveActivity()
} contentStates: {
  StriveActivityAttributes.ContentState(
    platform: "HEETCH",
    fare: 6.5,
    hourlyRate: 14,
    kmRate: 0.42,
    distanceKm: 15.2,
    durationMin: 28,
    verdictLevel: 0
  )
}

@available(iOS 17.0, *)
#Preview("Dynamic Island Expanded", as: .dynamicIsland(.expanded), using: StriveActivityAttributes()) {
  StriveLiveActivity()
} contentStates: {
  StriveActivityAttributes.ContentState(
    platform: "UBER",
    fare: 24.0,
    hourlyRate: 37,
    kmRate: 1.52,
    distanceKm: 12.6,
    durationMin: 29,
    verdictLevel: 2
  )
}

@available(iOS 17.0, *)
#Preview("Dynamic Island Compact", as: .dynamicIsland(.compact), using: StriveActivityAttributes()) {
  StriveLiveActivity()
} contentStates: {
  StriveActivityAttributes.ContentState(
    platform: "UBER",
    fare: 24.0,
    hourlyRate: 37,
    kmRate: 1.52,
    distanceKm: 12.6,
    durationMin: 29,
    verdictLevel: 2
  )
}

@available(iOS 17.0, *)
#Preview("Dynamic Island Minimal", as: .dynamicIsland(.minimal), using: StriveActivityAttributes()) {
  StriveLiveActivity()
} contentStates: {
  StriveActivityAttributes.ContentState(
    platform: "UBER",
    fare: 24.0,
    hourlyRate: 37,
    kmRate: 1.52,
    distanceKm: 12.6,
    durationMin: 29,
    verdictLevel: 2
  )
}

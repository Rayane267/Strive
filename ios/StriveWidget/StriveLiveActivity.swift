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
      let isIdle = context.state.platform == "IDLE"
      let isError = context.state.platform == "ERROR"
      // Teaser quota free : on réutilise le visuel résultat mais flouté + cadenas.
      let isLocked = context.state.platform == "LOCKED"
      let errorRed = Color(red: 0.94, green: 0.27, blue: 0.27)
      let lockGreen = Color(red: 0.0, green: 0.78, blue: 0.32)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          if isError {
            Image(systemName: "xmark.circle.fill")
              .font(.system(size: 18, weight: .bold))
              .foregroundColor(errorRed)
              .padding(.leading, 6)
          } else if isScanning {
            ProgressView()
              .tint(.white)
              .padding(.leading, 6)
          } else if isLocked {
            Image(systemName: "lock.fill")
              .font(.system(size: 16, weight: .bold))
              .foregroundColor(lockGreen)
              .padding(.leading, 6)
          } else if !isIdle {
            Text(context.state.platform.capitalized)
              .font(.system(size: 14, weight: .semibold))
              .foregroundColor(.white.opacity(0.75))
              .padding(.leading, 6)
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          if !isScanning && !isIdle && !isError && !isLocked {
            KmRateText(value: context.state.kmRate, level: context.state.verdictLevel)
              .padding(.trailing, 6)
          }
        }
        DynamicIslandExpandedRegion(.center) {
          if isError {
            Text("Analyse impossible")
              .font(.system(size: 14, weight: .semibold))
              .foregroundColor(.white.opacity(0.75))
          } else if isScanning {
            Text("Analyse…")
              .font(.system(size: 14, weight: .semibold))
              .foregroundColor(.white.opacity(0.75))
          } else if isLocked {
            Text("Passe Plus pour voir")
              .font(.system(size: 14, weight: .bold))
              .foregroundColor(.white)
          } else if !isIdle {
            HStack(spacing: 10) {
              HourlyRate(value: context.state.hourlyRate, level: context.state.verdictLevel)
              FarePill(fare: context.state.fare, level: context.state.verdictLevel)
            }
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          if isError {
            Text("Réessayez avec une autre capture")
              .font(.system(size: 13, weight: .medium))
              .foregroundColor(.white.opacity(0.45))
              .padding(.vertical, 4)
          } else if isLocked {
            Text("Se rembourse en une course")
              .font(.system(size: 12, weight: .medium))
              .foregroundColor(.white.opacity(0.5))
              .padding(.vertical, 4)
          } else if !isScanning && !isIdle {
            RouteRow(
              distanceKm: context.state.distanceKm,
              durationMin: context.state.durationMin,
              level: context.state.verdictLevel
            )
            .padding(.horizontal, 6)
            .padding(.top, 6)
            .padding(.bottom, 4)
          }
        }
      } compactLeading: {
        if isError {
          Image(systemName: "xmark.circle.fill")
            .foregroundColor(errorRed)
        } else if isScanning {
          ProgressView()
            .tint(.white)
        } else if isLocked {
          Image(systemName: "lock.fill")
            .foregroundColor(lockGreen)
        } else if isIdle {
          EmptyView()
        } else {
          Image(systemName: "car.fill")
            .foregroundColor(verdictColor(context.state.verdictLevel))
        }
      } compactTrailing: {
        if isError {
          Text("Erreur")
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(errorRed)
        } else if isScanning {
          Text("…")
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(.white.opacity(0.6))
        } else if isLocked {
          Text("Plus")
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(lockGreen)
        } else if isIdle {
          EmptyView()
        } else {
          Text("€\(Int(context.state.hourlyRate))/h")
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(verdictColor(context.state.verdictLevel))
        }
      } minimal: {
        if isError {
          Image(systemName: "xmark.circle.fill")
            .foregroundColor(errorRed)
        } else if isIdle {
          EmptyView()
        } else if isScanning {
          ProgressView()
            .tint(.white)
        } else if isLocked {
          Image(systemName: "lock.fill")
            .foregroundColor(lockGreen)
        } else {
          Image(systemName: verdictIcon(context.state.verdictLevel))
            .foregroundColor(verdictColor(context.state.verdictLevel))
        }
      }
      .keylineTint(isError ? errorRed : (isIdle || isScanning) ? .white : isLocked ? lockGreen : verdictColor(context.state.verdictLevel))
    }
  }
}

// MARK: - Lock Screen (banner haut quand pas de Dynamic Island)

@available(iOS 16.2, *)
private struct LockScreenView: View {
  let state: StriveActivityAttributes.ContentState
  var body: some View {
    let isScanning = state.platform == "SCANNING"
    let isIdle = state.platform == "IDLE"
    let isError = state.platform == "ERROR"
    let isLocked = state.platform == "LOCKED"
    let hasResult = !isScanning && !isIdle && !isError && !isLocked

    if isLocked {
      // ── Teaser quota free : vrai layout résultat (vert) mais flouté + cadenas ──
      ZStack {
        VStack(spacing: 12) {
          HStack(spacing: 8) {
            Text("Course")
              .font(.system(size: 15, weight: .semibold))
              .foregroundColor(.white.opacity(0.75))

            HourlyRate(value: state.hourlyRate, level: state.verdictLevel)

            Spacer()

            FarePill(fare: state.fare, level: state.verdictLevel)

            KmRateText(value: state.kmRate, level: state.verdictLevel)
          }

          RouteRow(
            distanceKm: state.distanceKm,
            durationMin: state.durationMin,
            level: state.verdictLevel
          )
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .blur(radius: 7)

        VStack(spacing: 3) {
          Image(systemName: "lock.fill")
            .font(.system(size: 17, weight: .bold))
            .foregroundColor(.white)
          Text("Passe Plus pour voir")
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(.white)
          Text("Se rembourse en une course")
            .font(.system(size: 11, weight: .medium))
            .foregroundColor(.white.opacity(0.6))
        }
      }
    } else if hasResult {
      // ── Résultat scan — même layout que Dynamic Island expanded ──
      VStack(spacing: 12) {
        HStack(spacing: 8) {
          Text(state.platform.capitalized)
            .font(.system(size: 15, weight: .semibold))
            .foregroundColor(.white.opacity(0.75))

          HourlyRate(value: state.hourlyRate, level: state.verdictLevel)

          Spacer()

          FarePill(fare: state.fare, level: state.verdictLevel)

          KmRateText(value: state.kmRate, level: state.verdictLevel)
        }

        RouteRow(
          distanceKm: state.distanceKm,
          durationMin: state.durationMin,
          level: state.verdictLevel
        )
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 14)
    } else {
      // ── Idle / Scanning / Error — session KPIs ──
      let accent = Color(red: 0.0, green: 0.9, blue: 0.46)
      let errorRed = Color(red: 0.94, green: 0.27, blue: 0.27)

      VStack(spacing: 0) {
        HStack(spacing: 10) {
          Image("StriveLogo")
            .resizable()
            .aspectRatio(contentMode: .fill)
            .frame(width: 32, height: 32)
            .clipShape(RoundedRectangle(cornerRadius: 9))

          Text("STRIVE")
            .font(.system(size: 12, weight: .black, design: .rounded))
            .tracking(2.5)
            .foregroundColor(.white.opacity(0.45))

          Spacer()

          if isScanning {
            HStack(spacing: 5) {
              ProgressView().tint(accent).scaleEffect(0.7)
              Text("Analyse…")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.white.opacity(0.5))
            }
          } else if isError {
            Text("Erreur")
              .font(.system(size: 11, weight: .bold))
              .foregroundColor(errorRed)
          } else {
            Text(formatOnlineTime(state.onlineMinutes))
              .font(.system(size: 11, weight: .bold, design: .monospaced))
              .foregroundColor(.white.opacity(0.4))
              .padding(.horizontal, 8)
              .padding(.vertical, 3)
              .background(Capsule().fill(.white.opacity(0.07)))
          }
        }
        .padding(.bottom, 14)

        if !isScanning && !isError {
          HStack(spacing: 0) {
            VStack(spacing: 2) {
              Text(String(format: "%.0f€", state.todayEarnings))
                .font(.system(size: 24, weight: .heavy))
                .foregroundColor(.white)
              Text("GAINS")
                .font(.system(size: 8, weight: .heavy))
                .tracking(1)
                .foregroundColor(.white.opacity(0.3))
            }
            .frame(maxWidth: .infinity)

            Rectangle()
              .fill(accent.opacity(0.2))
              .frame(width: 1, height: 32)

            VStack(spacing: 2) {
              Text(String(format: "%.0f€", state.todayHourlyRate))
                .font(.system(size: 24, weight: .heavy))
                .foregroundColor(accent)
              Text("/HEURE")
                .font(.system(size: 8, weight: .heavy))
                .tracking(1)
                .foregroundColor(accent.opacity(0.5))
            }
            .frame(maxWidth: .infinity)

            Rectangle()
              .fill(accent.opacity(0.2))
              .frame(width: 1, height: 32)

            VStack(spacing: 2) {
              Text(String(format: "%.1f", state.todayKm))
                .font(.system(size: 24, weight: .heavy))
                .foregroundColor(.white)
              Text("KM")
                .font(.system(size: 8, weight: .heavy))
                .tracking(1)
                .foregroundColor(.white.opacity(0.3))
            }
            .frame(maxWidth: .infinity)
          }
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 14)
    }
  }
}

@available(iOS 16.2, *)
private func formatOnlineTime(_ minutes: Int) -> String {
  let h = minutes / 60
  let m = minutes % 60
  return h > 0 ? String(format: "%dh%02d", h, m) : "\(m)min"
}

// MARK: - KPI Composants

@available(iOS 16.2, *)
private struct KpiItem: View {
  let value: String
  let label: String
  var body: some View {
    VStack(spacing: 3) {
      Text(value)
        .font(.system(size: 14, weight: .heavy))
        .foregroundColor(.white)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
      Text(label)
        .font(.system(size: 10, weight: .medium))
        .foregroundColor(.white.opacity(0.5))
        .lineLimit(1)
    }
    .frame(maxWidth: .infinity)
  }
}

@available(iOS 16.2, *)
private struct KpiDivider: View {
  var body: some View {
    Rectangle()
      .fill(.white.opacity(0.15))
      .frame(width: 1, height: 28)
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
        .font(.system(size: 28, weight: .heavy))
        .foregroundColor(.white)
      Text("/h")
        .font(.system(size: 14, weight: .semibold))
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
      .font(.system(size: 14, weight: .bold))
      .foregroundColor(.white)
      .padding(.horizontal, 12)
      .padding(.vertical, 5)
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
    HStack(spacing: 4) {
      Image(systemName: "arrow.up.right")
        .font(.system(size: 12, weight: .heavy))
        .foregroundColor(verdictColor(level))
      Text(String(format: "€%.2f/km", value))
        .font(.system(size: 14, weight: .semibold))
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
    HStack(alignment: .center, spacing: 12) {
      ZStack {
        Circle()
          .fill(verdictColor(level))
          .frame(width: 28, height: 28)
        Image(systemName: "car.fill")
          .font(.system(size: 13, weight: .bold))
          .foregroundColor(.black)
      }

      ZStack {
        Capsule()
          .fill(verdictColor(level).opacity(0.85))
          .frame(height: 4)
        ZStack {
          Circle()
            .fill(verdictColor(level))
            .frame(width: 24, height: 24)
          Image(systemName: "figure.wave")
            .font(.system(size: 12, weight: .bold))
            .foregroundColor(.black)
        }
      }

      VStack(alignment: .trailing, spacing: 2) {
        Text("\(durationMin)min")
          .font(.system(size: 15, weight: .bold))
          .foregroundColor(.white)
        Text(String(format: "%.1fkm", distanceKm))
          .font(.system(size: 12, weight: .semibold))
          .foregroundColor(.white.opacity(0.55))
      }

      ZStack {
        Circle()
          .fill(verdictColor(level))
          .frame(width: 28, height: 28)
        Image(systemName: verdictIcon(level))
          .font(.system(size: 13, weight: .bold))
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
#Preview("Lock Screen — Verrouillé (quota free)", as: .content, using: StriveActivityAttributes()) {
  StriveLiveActivity()
} contentStates: {
  StriveActivityAttributes.ContentState(
    platform: "LOCKED",
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
    platform: "UBER",
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
    platform: "UBER",
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

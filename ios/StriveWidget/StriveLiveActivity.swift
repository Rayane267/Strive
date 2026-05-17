import SwiftUI
import WidgetKit
import ActivityKit

/// Vues Live Activity Strive — affichées dans la Dynamic Island (iPhone 14 Pro+)
/// et sur le Lock Screen / banner top (autres iPhones, iOS 16.1+).
///
/// Design = ROW 1 : Plateforme · €/h · [pill €fare] · ↑€/km
///          ROW 2 : 🚗 ────●──── 22min / 12.1km · ⓘ
@available(iOS 16.2, *)
struct StriveLiveActivity: Widget {

  var body: some WidgetConfiguration {
    ActivityConfiguration(for: StriveActivityAttributes.self) { context in
      // === Lock Screen / Banner (top of screen quand pas de Dynamic Island) ===
      LockScreenView(state: context.state)
        .activityBackgroundTint(Color.black.opacity(0.9))
        .activitySystemActionForegroundColor(.white)

    } dynamicIsland: { context in
      DynamicIsland {
        // === Expanded — quand l'utilisateur tape ou hold sur l'island ===
        DynamicIslandExpandedRegion(.leading) {
          PlatformBadge(platform: context.state.platform)
        }
        DynamicIslandExpandedRegion(.trailing) {
          FarePill(fare: context.state.fare, level: context.state.verdictLevel)
        }
        DynamicIslandExpandedRegion(.center) {
          HourlyRateText(value: context.state.hourlyRate, level: context.state.verdictLevel)
        }
        DynamicIslandExpandedRegion(.bottom) {
          RouteRow(
            distanceKm: context.state.distanceKm,
            durationMin: context.state.durationMin,
            kmRate: context.state.kmRate,
            level: context.state.verdictLevel
          )
        }
      } compactLeading: {
        // === Compact (état "pillule" — toujours visible quand activité active)
        Image(systemName: "car.fill")
          .foregroundColor(verdictColor(context.state.verdictLevel))
      } compactTrailing: {
        Text("€\(Int(context.state.hourlyRate))/h")
          .font(.system(size: 14, weight: .bold))
          .foregroundColor(verdictColor(context.state.verdictLevel))
      } minimal: {
        // === Minimal (quand plusieurs activités en concurrence) ===
        Image(systemName: verdictIcon(context.state.verdictLevel))
          .foregroundColor(verdictColor(context.state.verdictLevel))
      }
      .keylineTint(verdictColor(context.state.verdictLevel))
    }
  }
}

// MARK: - Lock Screen View (fallback no-island)

@available(iOS 16.2, *)
private struct LockScreenView: View {
  let state: StriveActivityAttributes.ContentState

  var body: some View {
    VStack(spacing: 10) {
      // ROW 1 : Platform · €/h · pill prix · ↑€/km
      HStack(alignment: .center, spacing: 8) {
        Text(state.platform.capitalized)
          .font(.system(size: 15, weight: .bold))
          .foregroundColor(platformColor(state.platform))

        Text("€\(Int(state.hourlyRate))")
          .font(.system(size: 22, weight: .black))
          .foregroundColor(verdictColor(state.verdictLevel))
        Text("/h")
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(.white.opacity(0.55))

        Spacer(minLength: 8)

        FarePill(fare: state.fare, level: state.verdictLevel)

        Spacer(minLength: 8)

        Text(String(format: "↑€%.2f/ml", state.kmRate))
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(.white)
      }

      // ROW 2 : 🚗 ─── ● ─── 22min / 12.1km · ⓘ
      RouteRow(
        distanceKm: state.distanceKm,
        durationMin: state.durationMin,
        kmRate: state.kmRate,
        level: state.verdictLevel
      )
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
  }
}

// MARK: - Composants partagés

@available(iOS 16.2, *)
private struct PlatformBadge: View {
  let platform: String
  var body: some View {
    Text(platform.capitalized)
      .font(.system(size: 14, weight: .bold))
      .foregroundColor(platformColor(platform))
      .padding(.leading, 4)
  }
}

@available(iOS 16.2, *)
private struct HourlyRateText: View {
  let value: Double
  let level: Int
  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 2) {
      Text("€\(Int(value))")
        .font(.system(size: 22, weight: .black))
        .foregroundColor(verdictColor(level))
      Text("/h")
        .font(.system(size: 12, weight: .semibold))
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
      .font(.system(size: 14, weight: .heavy))
      .foregroundColor(.black)
      .padding(.horizontal, 10)
      .padding(.vertical, 4)
      .background(
        Capsule().fill(verdictColor(level))
      )
  }
}

@available(iOS 16.2, *)
private struct RouteRow: View {
  let distanceKm: Double
  let durationMin: Int
  let kmRate: Double
  let level: Int

  var body: some View {
    HStack(alignment: .center, spacing: 8) {
      // Cercle voiture (départ)
      ZStack {
        Circle()
          .fill(verdictColor(level))
          .frame(width: 22, height: 22)
        Image(systemName: "car.fill")
          .font(.system(size: 11, weight: .bold))
          .foregroundColor(.black)
      }

      // Ligne avec dot central
      ZStack {
        Rectangle()
          .fill(verdictColor(level))
          .frame(height: 2)
        Circle()
          .fill(verdictColor(level))
          .frame(width: 10, height: 10)
      }

      // Bloc durée + distance
      VStack(alignment: .trailing, spacing: 0) {
        Text("\(durationMin)min")
          .font(.system(size: 13, weight: .bold))
          .foregroundColor(.white)
        Text(String(format: "%.1fkm", distanceKm))
          .font(.system(size: 11, weight: .semibold))
          .foregroundColor(.white.opacity(0.55))
      }

      // Cercle warning (arrivée)
      ZStack {
        Circle()
          .fill(verdictColor(level))
          .frame(width: 22, height: 22)
        Image(systemName: verdictIcon(level))
          .font(.system(size: 11, weight: .bold))
          .foregroundColor(.black)
      }
    }
  }
}

// MARK: - Helpers couleurs

@available(iOS 16.2, *)
private func verdictColor(_ level: Int) -> Color {
  switch level {
  case 2: return Color(red: 0.0, green: 0.78, blue: 0.32)   // vert
  case 1: return Color(red: 1.0, green: 0.60, blue: 0.0)    // orange
  default: return Color(red: 0.94, green: 0.27, blue: 0.27) // rouge
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

@available(iOS 16.2, *)
private func platformColor(_ platform: String) -> Color {
  switch platform.uppercased() {
  case "UBER": return .white
  case "BOLT": return Color(red: 0.20, green: 0.83, blue: 0.48)
  case "HEETCH": return Color(red: 1.0, green: 0.23, blue: 0.50)
  default: return .white.opacity(0.55)
  }
}

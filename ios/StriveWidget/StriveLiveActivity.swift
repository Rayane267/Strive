import SwiftUI
import WidgetKit
import ActivityKit
import AppIntents

@available(iOS 16.2, *)
struct StriveLiveActivity: Widget {

  var body: some WidgetConfiguration {
    ActivityConfiguration(for: StriveActivityAttributes.self) { context in
      LockScreenView(state: context.state, stale: context.isStale)
        // Tint opaque : en présentation bannière (iPhone sans Dynamic Island)
        // et en mode clair, un tint semi-transparent n'est pas honoré de façon
        // fiable → fond blanc + texte blanc = rectangle blanc. LockScreenView
        // pose AUSSI son propre fond noir plein (ceinture + bretelles).
        .activityBackgroundTint(.black)
        .activitySystemActionForegroundColor(.white)

    } dynamicIsland: { context in
      // Les retours à l'état de base passent par des `DispatchQueue.asyncAfter`
      // de l'app hôte : quand le chauffeur est dans Uber/Maps, Strive est
      // suspendue et ces timers ne se déclenchent pas → la carte restait bloquée
      // sur le verdict (croix rouge en `minimal`) indéfiniment. Le `staleDate`,
      // lui, est arbitré par le système : passé ce délai on retombe sur l'idle.
      let stale = context.isStale
      let isScanning = !stale && context.state.platform == "SCANNING"
      // Rappel post-résultat : 20 s pendant lesquelles il ne reste que le prix
      // de la course et le €/km, le temps de les relire. Compté comme idle par
      // toutes les branches « résultat » — la carte complète a disparu — mais
      // traité explicitement là où il doit s'afficher.
      let isRecap = !stale && context.state.platform == "RECAP"
      let isIdle = stale || context.state.platform == "IDLE" || isRecap
      let isError = !stale && context.state.platform == "ERROR"
      // Teaser quota free : on réutilise le visuel résultat mais flouté + cadenas.
      let isLocked = !stale && context.state.platform == "LOCKED"
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
          } else if isIdle {
            // Logo, faute de quoi la région reste vide — et une région vide en
            // présentation ÉTENDUE donne un grand rectangle noir. C'est ce qui se
            // produisait pendant les deux secondes de repli après une décision,
            // et à chaque appui long sur l'île en session au repos : les quatre
            // régions excluaient `isIdle`, donc iOS n'avait rien à dessiner.
            Image("StriveLogo")
              .resizable()
              .aspectRatio(contentMode: .fill)
              .frame(width: 26, height: 26)
              .clipShape(RoundedRectangle(cornerRadius: 7))
              .padding(.leading, 6)
          } else {
            Text(context.state.platform.capitalized)
              .font(.system(size: 14, weight: .semibold))
              .foregroundColor(.white.opacity(0.75))
              .padding(.leading, 6)
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          if isIdle && !isScanning && !isError && !isLocked {
            // Timer de session, rafraîchi par iOS sans réveiller l'app — même
            // mécanique que sur l'écran verrouillé.
            Group {
              if let epoch = context.state.sessionStartEpoch {
                Text(Date(timeIntervalSince1970: epoch), style: .timer)
                  .monospacedDigit()
                  .multilineTextAlignment(.trailing)
                  .frame(maxWidth: 58, alignment: .trailing)
              } else {
                Text(formatOnlineTime(context.state.onlineMinutes))
              }
            }
            .font(.system(size: 12, weight: .bold, design: .monospaced))
            .foregroundColor(.white.opacity(0.45))
            .padding(.trailing, 6)
          } else if !isScanning && !isError && !isLocked {
            KmRateText(value: context.state.kmRate, level: context.state.verdictLevel)
              .padding(.trailing, 6)
          }
        }
        DynamicIslandExpandedRegion(.center) {
          if isError {
            Text(laString(fr: "Analyse impossible", en: "Analysis failed"))
              .font(.system(size: 14, weight: .semibold))
              .foregroundColor(.white.opacity(0.75))
          } else if isScanning {
            Text(laString(fr: "Analyse…", en: "Analyzing…"))
              .font(.system(size: 14, weight: .semibold))
              .foregroundColor(.white.opacity(0.75))
          } else if isLocked {
            Text(laString(fr: "Passe Plus pour voir", en: "Go Plus to see"))
              .font(.system(size: 14, weight: .bold))
              .foregroundColor(.white)
          } else if isRecap {
            HStack(spacing: 10) {
              FarePill(fare: context.state.fare, level: context.state.verdictLevel)
              KmRateText(value: context.state.kmRate, level: context.state.verdictLevel)
            }
          } else if isIdle {
            // Le libellé de session porte la région centrale ; les chiffres sont
            // en dessous, dans la région basse, où ils ont la largeur.
            Text(laString(fr: "Session en cours", en: "Session running"))
              .font(.system(size: 12, weight: .semibold))
              .foregroundColor(.white.opacity(0.45))
          } else {
            HStack(spacing: 10) {
              HourlyRate(value: context.state.hourlyRate, level: context.state.verdictLevel)
              FarePill(fare: context.state.fare, level: context.state.verdictLevel)
            }
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          if isError {
            Text(laString(fr: "Réessayez avec une autre capture", en: "Try another screenshot"))
              .font(.system(size: 13, weight: .medium))
              .foregroundColor(.white.opacity(0.45))
              .padding(.vertical, 4)
          } else if isLocked {
            Text(laString(fr: "Se rembourse en une course", en: "Pays for itself in one ride"))
              .font(.system(size: 12, weight: .medium))
              .foregroundColor(.white.opacity(0.5))
              .padding(.vertical, 4)
          } else if isIdle && !isScanning {
            // Gains du jour, €/h, km. Mêmes chiffres que l'écran verrouillé mais
            // PAS la même mise en forme : ici une ligne, là-bas trois colonnes.
            // Voir `SessionDashboard`.
            SessionDashboard(state: context.state)
              .padding(.horizontal, 6)
              .padding(.top, 2)
          } else if !isScanning {
            VStack(spacing: 4) {
              RouteRow(
                distanceKm: context.state.distanceKm,
                durationMin: context.state.durationMin,
                level: context.state.verdictLevel
              )
              .padding(.horizontal, 6)
              if #available(iOS 17.0, *), let ts = context.state.scanTs, ts > 0 {
                DecisionButtons(scanTs: ts)
                  .padding(.horizontal, 6)
              }
            }
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
        } else if isRecap {
          Text(String(format: "%.0f€", context.state.fare))
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(verdictColor(context.state.verdictLevel))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
        } else if isIdle {
          Image("StriveLogo")
            .resizable()
            .aspectRatio(contentMode: .fill)
            .frame(width: 20, height: 20)
            .clipShape(RoundedRectangle(cornerRadius: 5))
        } else {
          // Icône de verdict plutôt que `car.fill` : sur les ~10 s dont dispose le
          // chauffeur, la forme se lit plus vite que la couleur (soleil, volant,
          // daltonisme) et `car.fill` n'apprenait rien. Aligné sur `minimal`.
          Image(systemName: verdictIcon(context.state.verdictLevel))
            .foregroundColor(verdictColor(context.state.verdictLevel))
        }
      } compactTrailing: {
        if isError {
          Text(laString(fr: "Erreur", en: "Error"))
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
        } else if isRecap {
          Text(String(format: "%.2f/km", context.state.kmRate))
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(verdictColor(context.state.verdictLevel))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
        } else if isIdle {
          EmptyView()
        } else {
          Text("€\(Int(context.state.hourlyRate))/h")
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(verdictColor(context.state.verdictLevel))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
        }
      } minimal: {
        // `minimal` est la SEULE surface visible quand autre chose occupe le
        // Dynamic Island — un appel en cours au premier chef. Dans ce cas iOS ne
        // déplie pas l'activité de lui-même : ce cercle de ~20 pt est tout ce
        // que le chauffeur reçoit, et c'est là que le verdict doit atterrir.
        //
        // Un glyphe teinté sur fond noir n'y suffit pas : trait fin, faible
        // surface colorée, illisible du coin de l'œil au volant ou en plein
        // soleil — il fallait toucher l'île pour lire. Une PASTILLE PLEINE
        // inverse le rapport : la couleur occupe tout le disque et se lit en
        // vision périphérique, le glyphe en négatif reste là pour ceux qui ne
        // distinguent pas rouge et vert.
        if isError {
          Image(systemName: "xmark")
            .verdictPill(errorRed)
        } else if isIdle {
          Image("StriveLogo")
            .resizable()
            .aspectRatio(contentMode: .fill)
            .frame(width: 18, height: 18)
            .clipShape(Circle())
        } else if isScanning {
          ProgressView()
            .tint(.white)
        } else if isLocked {
          Image(systemName: "lock.fill")
            .verdictPill(lockGreen)
        } else {
          // Résultat ET récap : même rendu. Le récap reste un verdict à lire.
          Image(systemName: verdictIcon(context.state.verdictLevel))
            .verdictPill(verdictColor(context.state.verdictLevel))
        }
      }
      .keylineTint(isError ? errorRed : isRecap ? verdictColor(context.state.verdictLevel) : (isIdle || isScanning) ? .white : isLocked ? lockGreen : verdictColor(context.state.verdictLevel))
    }
  }
}

// MARK: - Lock Screen (banner haut quand pas de Dynamic Island)

@available(iOS 16.2, *)
private struct LockScreenView: View {
  let state: StriveActivityAttributes.ContentState
  /// Contenu périmé (staleDate dépassé) : l'app hôte est suspendue et n'a pas pu
  /// repasser la carte en idle — on l'affiche comme telle plutôt que de figer un
  /// verdict vieux de plusieurs minutes.
  var stale: Bool = false
  var body: some View {
    let isScanning = !stale && state.platform == "SCANNING"
    let isError = !stale && state.platform == "ERROR"
    let isLocked = !stale && state.platform == "LOCKED"
    // Vraie course (UBER/BOLT/HEETCH/UNKNOWN…) — ni idle, ni scanning, ni erreur,
    // ni teaser. C'est le seul état où l'on veut la CARTE RÉSULTAT sur le lock
    // screen (crucial pour les iPhone sans Dynamic Island : voir la branche).
    // "RECAP" exclu : c'est l'état d'après-résultat (prix + €/km pendant 20 s,
    // visible dans la Dynamic Island). Sur le lock screen la carte complète a
    // disparu, on retombe donc sur le résumé de session comme pour l'idle.
    let isResult = !stale && !isScanning && !isError && !isLocked
      && state.platform != "IDLE" && state.platform != "RECAP"

    // Fond noir posé en .background (et NON en ZStack avec un Color.black, qui
    // est greedy → force la vue à remplir toute la hauteur proposée → bannière
    // Live Activity rognée, on ne voyait que « le bout du haut »). .background
    // épouse la taille du contenu et garantit quand même un fond opaque (pas de
    // rectangle blanc sur les iPhone sans Dynamic Island).
    return Group {
      if isLocked {
      // ── Teaser quota free : vrai layout résultat (vert) mais flouté + cadenas ──
      ZStack {
        VStack(spacing: 12) {
          HStack(spacing: 8) {
            Text(laString(fr: "Course", en: "Ride"))
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
          Text(laString(fr: "Passe Plus pour voir", en: "Go Plus to see"))
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(.white)
          Text(laString(fr: "Se rembourse en une course", en: "Pays for itself in one ride"))
            .font(.system(size: 11, weight: .medium))
            .foregroundColor(.white.opacity(0.6))
        }
      }
    } else if isResult {
      // ── Carte RÉSULTAT sur le lock screen / bannière. Indispensable pour les
      // iPhone SANS Dynamic Island (iPhone 11–14 non-Pro, SE…), qui n'ont QUE
      // cette présentation : sans cette branche, ils ne verraient jamais le
      // résultat de scan (uniquement le dashboard de session). L'auto-dismiss
      // 20 s (LiveActivityManager) fait ensuite passer au récap, puis 20 s plus
      // tard à la carte session. ──
      VStack(spacing: 10) {
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

        // Boutons Accepter/Refuser directement sur le lock screen (iOS 17+) —
        // sinon les iPhone sans Dynamic Island n'ont aucun moyen de taguer sans
        // ouvrir l'app.
        if #available(iOS 17.0, *), let ts = state.scanTs, ts > 0 {
          DecisionButtons(scanTs: ts)
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 14)
    } else {
      // ── Idle / analyse en cours / erreur : résumé de session (le compteur de
      // durée tourne seul, rafraîchi par iOS sans réveiller l'app). ──
      let accent = laAccent
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
              Text(laString(fr: "Analyse…", en: "Analyzing…"))
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.white.opacity(0.5))
            }
          } else if isError {
            Text(laString(fr: "Erreur", en: "Error"))
              .font(.system(size: 11, weight: .bold))
              .foregroundColor(errorRed)
          } else {
            Group {
              if let epoch = state.sessionStartEpoch {
                // Compteur qui tourne SEUL sur le lock screen (durée de session
                // du jour, cumulée) — iOS le rafraîchit sans réveiller l'app.
                Text(Date(timeIntervalSince1970: epoch), style: .timer)
                  .monospacedDigit()
                  .multilineTextAlignment(.trailing)
                  .frame(maxWidth: 64, alignment: .trailing)
              } else {
                Text(formatOnlineTime(state.onlineMinutes))
              }
            }
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
                .lineLimit(1)
                .minimumScaleFactor(0.6)
              Text(laString(fr: "GAINS", en: "EARNINGS"))
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
                .lineLimit(1)
                .minimumScaleFactor(0.6)
              Text(laString(fr: "/HEURE", en: "/HOUR"))
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
    .frame(maxWidth: .infinity)
    .background(Color.black)
  }
}

@available(iOS 16.2, *)
private func formatOnlineTime(_ minutes: Int) -> String {
  let h = minutes / 60
  let m = minutes % 60
  return h > 0 ? String(format: "%dh%02d", h, m) : "\(m)min"
}

/// Vert d'accent du widget. Remonté au niveau du fichier : il était déclaré en
/// local dans `LockScreenView` et une seconde copie allait apparaître dans le
/// tableau de bord de l'îlot — deux valeurs à maintenir en phase pour rien.
let laAccent = Color(red: 0.0, green: 0.9, blue: 0.46)

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

/// Tableau de bord de session pour la présentation ÉTENDUE en état IDLE.
///
/// Sans lui, les quatre régions de l'étendue étaient vides dès que l'activité
/// repassait au repos, et iOS dessinait un grand rectangle noir — visible deux
/// secondes après chaque décision, et en permanence sur un appui long.
///
/// EN UNE LIGNE, et non en colonnes comme sur l'écran verrouillé. Les deux
/// surfaces n'ont pas la même forme : le lock screen est haut, il peut empiler
/// un grand nombre au-dessus d'un libellé ; la région basse de l'îlot est une
/// bande large et plate. Y plaquer trois colonnes écrase les chiffres pour loger
/// des libellés qui, de toute façon, ne se lisent plus à cette taille.
///
/// D'où l'unité COLLÉE au nombre (`24€/h`, `86.4km`) plutôt qu'en légende : elle
/// occupe la largeur, qui est disponible, au lieu de la hauteur, qui ne l'est
/// pas. Un seul niveau de lecture, de gauche à droite.
@available(iOS 16.2, *)
private struct SessionDashboard: View {
  let state: StriveActivityAttributes.ContentState

  private var dot: some View {
    Text("·")
      .font(.system(size: 15, weight: .bold))
      .foregroundColor(.white.opacity(0.25))
  }

  var body: some View {
    HStack(spacing: 8) {
      // Les gains portent la ligne : c'est le seul chiffre que le chauffeur
      // vient chercher, les deux autres le qualifient.
      Text(String(format: "%.0f€", state.todayEarnings))
        .font(.system(size: 17, weight: .heavy))
        .foregroundColor(.white)
      dot
      Text(String(format: "%.0f€/h", state.todayHourlyRate))
        .font(.system(size: 15, weight: .bold))
        .foregroundColor(laAccent)
      dot
      Text(String(format: "%.0fkm", state.todayKm))
        .font(.system(size: 15, weight: .bold))
        .foregroundColor(.white.opacity(0.55))
    }
    .lineLimit(1)
    .minimumScaleFactor(0.7)
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
        .font(.system(size: 19, weight: .heavy))
        .foregroundColor(.white)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
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
      .font(.system(size: 14, weight: .bold))
      .foregroundColor(.white)
      .lineLimit(1)
      .minimumScaleFactor(0.6)
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
        .lineLimit(1)
        .minimumScaleFactor(0.6)
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
          .frame(width: 24, height: 24)
        Image(systemName: "car.fill")
          .font(.system(size: 11, weight: .bold))
          .foregroundColor(.black)
      }

      ZStack {
        Capsule()
          .fill(verdictColor(level).opacity(0.85))
          .frame(height: 4)
        ZStack {
          Circle()
            .fill(verdictColor(level))
            .frame(width: 20, height: 20)
          Image(systemName: "figure.wave")
            .font(.system(size: 10, weight: .bold))
            .foregroundColor(.black)
        }
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
          .frame(width: 24, height: 24)
        Image(systemName: verdictIcon(level))
          .font(.system(size: 11, weight: .bold))
          .foregroundColor(.black)
      }
    }
  }
}

// MARK: - Boutons Accepter / Refuser (iOS 17+)

/// Deux boutons interactifs qui taguent la course sans ouvrir l'app. Chaque tap
/// exécute RideDecisionIntent → écrit la décision dans l'App Group → réconcilié
/// côté JS (updateRideStatus). N'apparaît que si scanTs est connu.
@available(iOS 17.0, *)
private struct DecisionButtons: View {
  let scanTs: Double
  var body: some View {
    HStack(spacing: 8) {
      Button(intent: RideDecisionIntent(scanTs: scanTs, accepted: false)) {
        Label(laString(fr: "Refusée", en: "Declined"), systemImage: "xmark")
          .font(.system(size: 13, weight: .bold))
          .frame(maxWidth: .infinity)
          .padding(.vertical, 4)
          .background(Color(red: 0.94, green: 0.27, blue: 0.27))
          .foregroundColor(.white)
          .clipShape(Capsule())
      }
      .buttonStyle(.plain)

      Button(intent: RideDecisionIntent(scanTs: scanTs, accepted: true)) {
        Label(laString(fr: "Prise", en: "Taken"), systemImage: "checkmark")
          .font(.system(size: 13, weight: .bold))
          .frame(maxWidth: .infinity)
          .padding(.vertical, 4)
          .background(Color(red: 0.0, green: 0.78, blue: 0.32))
          .foregroundColor(.white)
          .clipShape(Capsule())
      }
      .buttonStyle(.plain)
    }
  }
}

// MARK: - Localisation

/// Résout la langue UI (fr/en) depuis l'App Group — même contrat que
/// `localizedString` dans LiveActivityManager, ShareViewController et
/// AnalyzeRideIntent. Le widget est une cible séparée, sans accès à ces helpers :
/// ses textes étaient donc figés en français, quelle que soit la langue de l'app.
///
/// ⚠️ Une Live Activity déjà affichée ne se re-rend pas sur changement de langue :
/// elle garde la sienne jusqu'au prochain `update()` (donc au prochain scan).
private func laString(fr: String, en: String) -> String {
  let groupId = Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String
    ?? "group.com.striveapp.app"
  // Anglais UNIQUEMENT si l'app est réglée en anglais ; français sinon. Pas de
  // repli sur la locale système : un chauffeur qui a mis Strive en français sur
  // un iPhone en anglais doit lire du français partout, y compris ici.
  guard let appLang = UserDefaults(suiteName: groupId)?.string(forKey: "appLanguage")
  else { return fr }
  return appLang.hasPrefix("en") ? en : fr
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

/// Pastille pleine pour la présentation `minimal` du Dynamic Island.
///
/// La couleur porte l'information, pas le trait : c'est le seul rendu qui reste
/// lisible en vision périphérique dans un disque de ~20 pt. Le glyphe est
/// conservé en négatif — un chauffeur daltonien ne doit pas dépendre de la
/// teinte pour distinguer un refus d'une acceptation.
@available(iOS 16.2, *)
private extension Image {
  func verdictPill(_ color: Color) -> some View {
    self
      .font(.system(size: 11, weight: .black))
      .foregroundColor(.black)
      .frame(width: 20, height: 20)
      .background(Circle().fill(color))
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

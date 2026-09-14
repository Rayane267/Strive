import SwiftUI

/// Palette du splash. Jumelle de `src/theme/colors.ts` et du `LaunchScreen`.
///
/// Recopiée en dur : ces quatre couleurs sont figées dans le storyboard (qu'aucun
/// code ne lit) et dans le PNG du logo. Les faire venir d'ailleurs donnerait
/// l'illusion d'une source unique là où il n'y en a pas.
private enum SplashPalette {
    static let background = Color(red: 10 / 255, green: 18 / 255, blue: 14 / 255)   // #0A120E
    static let tile       = Color(red: 28 / 255, green: 46 / 255, blue: 36 / 255)   // #1C2E24
    static let barLight   = Color(red: 232 / 255, green: 237 / 255, blue: 233 / 255) // #E8EDE9
    static let barMid     = Color(red: 130 / 255, green: 141 / 255, blue: 134 / 255) // #828D86
}

/// Le splash animé d'iOS : les trois capsules du logo se tracent au contour,
/// puis se remplissent, et le wordmark monte en fondu.
///
/// POURQUOI EN NATIF. Le splash JS (`SplashScreen.tsx`) n'existe qu'une fois le
/// pont React Native monté — trop tard pour ce geste, qui doit occuper
/// précisément le temps du boot. La vue ci-dessous se pose au-dessus de la
/// rootView et s'efface quand le JS signale qu'il est prêt.
///
/// CONTINUITÉ. L'image 0 de cette vue doit être l'exacte copie du
/// `LaunchScreen.storyboard` — Apple n'anime pas l'écran de lancement, il est
/// donc forcément le point de départ : fond, tuile vide, wordmark déjà posé.
/// Tout ce qui bouge ici part de cet état-là. Les mêmes valeurs se retrouvent
/// dans le storyboard (wordmark 56 pt noir) — les trois surfaces doivent rester
/// d'accord, barre d'accent retirée partout.
struct StriveSplashView: View {

    // MARK: Réglages

    /// Côté du logo. 120 pt : la tuile occupe environ un tiers de la largeur
    /// d'un iPhone courant, assez pour que le tracé se lise sans devenir un mur.
    var logoSize: CGFloat = 120

    /// Appelé quand l'animation est finie. Ne retire PAS la vue — c'est le
    /// contrôleur hôte qui décide, en croisant ce signal avec celui du JS.
    var onComplete: (() -> Void)?

    // MARK: Horloge
    //
    // Une seule table de temps, en secondes, dont tout découle. Le chevauchement
    // de 0,16 s entre deux barres est ce qui fait lire les trois tracés comme un
    // seul geste, et non comme trois animations à la file.

    private static let traceDuration: TimeInterval = 0.42
    private static let traceStarts: [TimeInterval] = [0, 0.26, 0.52]
    private static let fillAt: Double = 0.65          // du tracé de SA barre
    private static let fillDuration: TimeInterval = 0.22
    private static let wordStart: TimeInterval = 0.62
    private static let wordDuration: TimeInterval = 0.44
    private static let total: TimeInterval = 1.06

    // MARK: État

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var trace: [CGFloat] = [0, 0, 0]
    @State private var fill: [Double] = [0, 0, 0]
    @State private var wordOpacity: Double = 0
    @State private var wordOffset: CGFloat = 6

    private func barColor(_ index: Int) -> Color {
        index == 1 ? SplashPalette.barMid : SplashPalette.barLight
    }

    var body: some View {
        ZStack {
            SplashPalette.background.ignoresSafeArea()

            VStack(spacing: 28) {
                logo
                wordmark
            }
            // Le même décalage que le storyboard : le bloc est posé un cheveu
            // au-dessus du centre optique, pas au centre géométrique.
            .offset(y: -logoSize * 0.08)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Strive")
        .onAppear(perform: start)
    }

    private var logo: some View {
        ZStack {
            RoundedRectangle(
                cornerRadius: logoSize * StriveLogoMetrics.tileRadiusRatio,
                style: .continuous
            )
            .fill(SplashPalette.tile)

            ForEach(0..<StriveLogoMetrics.barCount, id: \.self) { i in
                ZStack {
                    // Le remplissage arrive par-dessous le contour : à
                    // mi-parcours on voit un trait fin qui court, puis la barre
                    // se remplit derrière lui.
                    StriveBarShape(index: i)
                        .fill(barColor(i))
                        .opacity(fill[i])

                    StriveBarShape(index: i)
                        .trim(from: 0, to: trace[i])
                        .stroke(barColor(i), style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
                }
            }
        }
        .frame(width: logoSize, height: logoSize)
    }

    private var wordmark: some View {
        Text("Strive")
            .font(.system(size: 56, weight: .black))
            .tracking(-2)
            .foregroundColor(.white)
            .opacity(wordOpacity)
            .offset(y: wordOffset)
    }

    // MARK: Lancement

    private func start() {
        // Reduce Motion : on pose l'état final, sans animation ni attente. Un
        // splash qui s'anime quand même est exactement ce que ce réglage
        // demande d'éviter, et rien ici ne porte d'information.
        guard !reduceMotion else {
            trace = [1, 1, 1]
            fill = [1, 1, 1]
            wordOpacity = 1
            wordOffset = 0
            onComplete?()
            return
        }

        for i in 0..<StriveLogoMetrics.barCount {
            let start = Self.traceStarts[i]

            withAnimation(.easeOut(duration: Self.traceDuration).delay(start)) {
                trace[i] = 1
            }
            withAnimation(
                .easeOut(duration: Self.fillDuration)
                    .delay(start + Self.traceDuration * Self.fillAt)
            ) {
                fill[i] = 1
            }
        }

        withAnimation(.easeOut(duration: Self.wordDuration).delay(Self.wordStart)) {
            wordOpacity = 1
            wordOffset = 0
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + Self.total) {
            onComplete?()
        }
    }
}

#if DEBUG
struct StriveSplashView_Previews: PreviewProvider {
    static var previews: some View {
        StriveSplashView()
    }
}
#endif

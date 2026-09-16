import SwiftUI

/// Géométrie du logo Strive, relevée au pixel sur `src/assets/strive-logo.png`.
///
/// POURQUOI DES CHIFFRES ET PAS L'IMAGE. Le PNG ne sait que s'afficher d'un
/// bloc : il n'a ni contour à parcourir, ni remplissage à séparer du tracé. Le
/// logo étant purement géométrique — trois capsules identiques décalées en
/// escalier — le transcrire en `Path` ne coûte rien et rend l'animation
/// possible. C'est aussi ce qui évite le pipeline PNG → Shape de
/// `swiftui-logo-draw` (numpy/scipy, ajustement par IoU) : il n'a d'intérêt que
/// pour un logo dessiné à main levée, pas pour trois rectangles arrondis.
///
/// Le canevas de référence est 192 × 192, les mesures y sont exactes (bords
/// relevés au seuil alpha) :
///   • capsules 84 × 24, rayon 12 — donc des demi-cercles pleins aux extrémités
///   • x = 66 / 54 / 42 → l'escalier, 12 px de décalage par barre
///   • y = 48 / 84 / 120 → pas de 36, soit 12 px de gouttière entre deux barres
///   • le bloc est centré : 48 px de marge en haut comme en bas
enum StriveLogoMetrics {
    /// Côté du canevas de référence. Tout le reste est exprimé dedans, puis mis
    /// à l'échelle du rect réel — la forme est donc indépendante de la taille.
    static let canvas: CGFloat = 192

    /// Rayon de la tuile. 0,25 du côté, arrondi continu : c'est le squircle des
    /// icônes iOS, la tuile du logo en est une.
    static let tileRadiusRatio: CGFloat = 0.25

    static let barSize = CGSize(width: 84, height: 24)
    static let barOrigins: [CGPoint] = [
        CGPoint(x: 66, y: 48),   // haute
        CGPoint(x: 54, y: 84),   // milieu — la seule grise
        CGPoint(x: 42, y: 120),  // basse
    ]

    static let barCount = barOrigins.count
}

/// Une capsule du logo, prête à être tracée par `.trim`.
///
/// Une forme PAR BARRE, et non les trois réunies dans un seul `Path` : `.trim`
/// répartit sa progression sur la longueur cumulée, ce qui donnerait bien un
/// tracé en séquence — mais imposerait une couleur unique aux trois, alors que
/// celle du milieu est grise. Trois formes, trois `trim` pilotés par la même
/// horloge : même enchaînement, couleurs libres.
///
/// Le tracé DÉMARRE au bord gauche du segment haut et tourne dans le sens des
/// aiguilles. Construit à la main plutôt qu'avec `addRoundedRect`, dont le point
/// de départ n'est pas garanti : c'est lui qui décide si la barre a l'air écrite
/// de la gauche vers la droite ou de se refermer n'importe où.
struct StriveBarShape: Shape {
    let index: Int

    func path(in rect: CGRect) -> Path {
        // `typealias` et non `let` : `StriveLogoMetrics` est un enum sans cas,
        // c'est-à-dire un espace de noms — il ne s'affecte pas à une variable.
        typealias M = StriveLogoMetrics
        guard M.barOrigins.indices.contains(index) else { return Path() }

        // Le logo reste carré et centré, quelle que soit la boîte qu'on lui donne.
        let side = min(rect.width, rect.height)
        let scale = side / M.canvas
        let dx = rect.minX + (rect.width - side) / 2
        let dy = rect.minY + (rect.height - side) / 2

        let origin = M.barOrigins[index]
        let x = dx + origin.x * scale
        let y = dy + origin.y * scale
        let w = M.barSize.width * scale
        let h = M.barSize.height * scale
        let r = h / 2

        var path = Path()
        path.move(to: CGPoint(x: x + r, y: y))
        path.addLine(to: CGPoint(x: x + w - r, y: y))
        path.addArc(
            center: CGPoint(x: x + w - r, y: y + r), radius: r,
            startAngle: .degrees(-90), endAngle: .degrees(90), clockwise: false
        )
        path.addLine(to: CGPoint(x: x + r, y: y + h))
        path.addArc(
            center: CGPoint(x: x + r, y: y + r), radius: r,
            startAngle: .degrees(90), endAngle: .degrees(270), clockwise: false
        )
        path.closeSubpath()
        return path
    }
}

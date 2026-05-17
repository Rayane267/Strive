import WidgetKit
import SwiftUI

/// Bundle de la Widget Extension — déclare toutes les widgets / live activities
/// fournies par cette target. Pour l'instant uniquement la Live Activity du
/// scanner (Dynamic Island + Lock Screen banner).
@main
@available(iOS 16.2, *)
struct StriveWidgetBundle: WidgetBundle {
  var body: some Widget {
    StriveLiveActivity()
  }
}

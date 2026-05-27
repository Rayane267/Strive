import Foundation

/// Port iOS du `OcrParser.kt` Android. La logique d'analyse doit rester
/// strictement identique entre les deux plateformes pour garantir la même
/// rentabilité affichée — toute modif ici DOIT être répercutée Android (et vice
/// versa).
///
/// Target Membership Xcode : `Strive` + `StriveShareExtension`.
final class OcrParser {

  static let shared = OcrParser()
  private init() {}

  // MARK: - Remote config (alignée avec Android)

  private var priceAnchors: [ScanPlatform: [String]] = [
    .UBER:    ["total", "fare", "trip fare", "estimated fare", "gain", "net"],
    .BOLT:    ["gain", "earning", "revenu", "estimé", "total", "net"],
    .HEETCH:  ["course", "tarif", "prix", "total", "net"],
    .UNKNOWN: ["total", "gain", "fare", "tarif", "net"],
  ]

  private var distanceAnchors: [String] = ["km", "kilomètre", "distance", "away"]

  private var fareMin: Double = 5.0
  private var fareMax: Double = 200.0
  private var distMin: Double = 0.3
  private var distMax: Double = 120.0
  private var rateMin: Double = 0.4
  private var rateMax: Double = 12.0

  /// Applique la remote config (même format JSON que Android).
  func updateConfig(_ configJson: String) {
    guard let data = configJson.data(using: .utf8),
          let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return }

    if let anchors = root["priceAnchors"] as? [String: Any] {
      for key in ["UBER", "BOLT", "HEETCH", "UNKNOWN"] {
        guard let platform = ScanPlatform(rawValue: key),
              let arr = anchors[key] as? [String]
        else { continue }
        priceAnchors[platform] = arr.map { $0.lowercased() }
      }
    }
    if let arr = root["distanceAnchors"] as? [String] {
      distanceAnchors = arr.map { $0.lowercased() }
    }
    if let s = root["sanity"] as? [String: Any] {
      if let v = s["fareMin"] as? NSNumber { fareMin = v.doubleValue }
      if let v = s["fareMax"] as? NSNumber { fareMax = v.doubleValue }
      if let v = s["distMin"] as? NSNumber { distMin = v.doubleValue }
      if let v = s["distMax"] as? NSNumber { distMax = v.doubleValue }
      if let v = s["rateMin"] as? NSNumber { rateMin = v.doubleValue }
      if let v = s["rateMax"] as? NSNumber { rateMax = v.doubleValue }
    }
  }

  // MARK: - Constants (mirror Android)

  private let platformKeywords: [ScanPlatform: [String]] = [
    .UBER: ["uber"], .BOLT: ["bolt"], .HEETCH: ["heetch"],
  ]

  private let addressStreetKeywords: [String] = [
    "rue", "avenue", "av.", "boulevard", "blvd", "bd", "bd.",
    "place", "pl.", "impasse", "imp.", "allée", "allee", "all.",
    "chemin", "ch.", "route", "rte", "rte.", "passage",
    "quai", "villa", "cité", "cite", "esplanade", "cours",
    "faubourg", "fg.", "voie", "sq.", "square",
    "street", "road", "lane", "drive", "st.", "rd.", "ave.", "way",
    "calle", "avenida", "plaza", "paseo", "carretera", "camino", "ronda",
    "via", "viale", "corso", "piazza", "strada", "vicolo", "largo",
    "straat", "laan", "plein", "gracht",
    "travessa", "rua",
    "gare", "aéroport", "aeroport", "airport", "terminal",
    "porte", "hôpital", "hopital", "hospital", "station",
    "bahnhof", "hauptbahnhof", "flughafen", "krankenhaus",
    "estación", "estacion", "aeropuerto",
    "stazione", "aeroporto", "ospedale",
  ]

  private let addressStreetSuffixes: [String] = [
    "straße", "strasse", "str.", "gasse", "weg", "allee", "platz",
    "damm", "ufer", "ring",
  ]

  private let nonAddressWords: Set<String> = [
    "uber", "bolt", "heetch", "total", "fare", "gain", "tarif",
    "accepted", "accepté", "min", "km", "estimated", "estimé",
  ]

  // MARK: - Regex (mêmes patterns que Android)

  private static let priceRegex = try! NSRegularExpression(
    pattern: #"(\d{1,3})\s*[.,]\s*(\d{1,2})(?!\d)"#)
  private static let priceWholeRegex = try! NSRegularExpression(
    pattern: #"(\d{1,3})\s*€"#)
  private static let distanceRegex = try! NSRegularExpression(
    pattern: #"(\d{1,3}(?:\s*[.,]\s*\d{1,2})?)\s*km"#, options: .caseInsensitive)
  private static let durationRegex = try! NSRegularExpression(
    pattern: #"(\d{1,3})\s*min"#, options: .caseInsensitive)
  private static let durationHourRegex = try! NSRegularExpression(
    pattern: #"(\d{1,2})\s*h\s*(\d{1,2})?\s*(?:min)?"#, options: .caseInsensitive)
  private static let pickupComboMinFirst = try! NSRegularExpression(
    pattern: #"(\d{1,3})\s*min[^0-9a-zà-ü]{0,6}(\d{1,3}(?:\s*[.,]\s*\d{1,2})?)\s*km"#,
    options: .caseInsensitive)
  private static let pickupComboKmFirst = try! NSRegularExpression(
    pattern: #"(\d{1,3}(?:\s*[.,]\s*\d{1,2})?)\s*km[^0-9a-zà-ü]{0,6}(\d{1,3})\s*min"#,
    options: .caseInsensitive)

  private func cleanNum(_ raw: String) -> String {
    raw.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ",", with: ".")
  }

  /// Corrige les confusions OCR chiffre↔lettre uniquement en contexte numérique
  /// (mirror exact de la fonction Kotlin).
  private func normalizeOcrDigits(_ s: String) -> String {
    var out = s
    let rules: [(String, (String) -> String)] = [
      // Runs l/I avant ".X"
      (#"(?<![a-zA-Zà-ü])[lI]+(?=[.,]\d)"#, { String(repeating: "1", count: $0.count) }),
      // Runs l/I avant "X.Y"
      (#"(?<![a-zA-Zà-ü])[lI]+(?=\d[.,]\d)"#, { String(repeating: "1", count: $0.count) }),
      // Runs l/I après "X."
      (#"(?<=\d[.,])[lI]+(?![a-zA-Zà-ü])"#, { String(repeating: "1", count: $0.count) }),
      // l/I isolé entre chiffres
      (#"(?<=\d)[lI](?=\d)"#, { _ in "1" }),
      // o/O variantes
      (#"(?<![a-zA-Zà-ü])[oO]+(?=[.,]\d)"#, { String(repeating: "0", count: $0.count) }),
      (#"(?<![a-zA-Zà-ü])[oO]+(?=\d[.,]\d)"#, { String(repeating: "0", count: $0.count) }),
      (#"(?<=\d[.,])[oO]+(?![a-zA-Zà-ü])"#, { String(repeating: "0", count: $0.count) }),
      (#"(?<=\d)[oO](?=\d)"#, { _ in "0" }),
      // S→5, B→8 entre chiffres
      (#"(?<=\d)[sS](?=\d)"#, { _ in "5" }),
      (#"(?<=\d)[bB](?=\d)"#, { _ in "8" }),
    ]
    for (pattern, replacer) in rules {
      out = replaceAll(out, pattern: pattern, options: [], replacer: replacer)
    }
    return out
  }

  private func replaceAll(_ input: String, pattern: String,
                          options: NSRegularExpression.Options,
                          replacer: (String) -> String) -> String {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return input }
    let nsInput = input as NSString
    var ranges: [(NSRange, String)] = []
    regex.enumerateMatches(in: input, range: NSRange(location: 0, length: nsInput.length)) { m, _, _ in
      guard let m = m else { return }
      ranges.append((m.range, replacer(nsInput.substring(with: m.range))))
    }
    var result = input
    for (range, repl) in ranges.reversed() {
      if let r = Range(range, in: result) {
        result.replaceSubrange(r, with: repl)
      }
    }
    return result
  }

  // MARK: - Entry point

  func parse(blocks: [OcrTextBlock], screenWidth: Int, screenHeight: Int, image: UIImage? = nil) -> ScanResultModel? {
    if blocks.isEmpty { return nil }

    let fullText = blocks.map { $0.text }.joined(separator: " ").lowercased()
    var platform = detectPlatform(fullText)
    if platform == .UNKNOWN, let img = image {
      platform = detectPlatformByColor(image: img)
    }

    guard let fare = extractFare(blocks: blocks, platform: platform, screenHeight: screenHeight)
    else { return nil }
    let fareBlockY = locateFareBlockY(blocks: blocks, fare: fare)

    let addressBlocks = findAddressBlocks(blocks: blocks, screenHeight: screenHeight, fareBlockY: fareBlockY)
    let pickupAddrBlock = addressBlocks.indices.contains(0) ? addressBlocks[0] : nil
    let destAddrBlock = addressBlocks.indices.contains(1) ? addressBlocks[1] : nil

    guard let distance = extractDistance(blocks: blocks, pickupAddr: pickupAddrBlock, destAddr: destAddrBlock)
    else { return nil }
    let duration = extractDuration(blocks: blocks, pickupAddr: pickupAddrBlock, destAddr: destAddrBlock)

    if !isSane(fare: fare, distanceKm: distance) { return nil }

    let pickup = extractPickupInfo(blocks: blocks, courseDistanceKm: distance)

    return ScanResultModel(
      platform: platform,
      fare: fare,
      distanceKm: distance,
      durationMin: duration,
      pickupAddress: pickupAddrBlock.map { mergeAddressContinuation(addrBlock: $0, allBlocks: blocks, screenHeight: screenHeight) },
      destinationAddress: destAddrBlock.map { mergeAddressContinuation(addrBlock: $0, allBlocks: blocks, screenHeight: screenHeight) },
      pickupDurationMin: pickup?.0,
      pickupDistanceKm: pickup?.1
    )
  }

  // MARK: - Platform detection

  private func detectPlatform(_ fullText: String) -> ScanPlatform {
    for (platform, keywords) in platformKeywords {
      if keywords.contains(where: { fullText.contains($0) }) { return platform }
    }
    return .UNKNOWN
  }

  /// Fallback : détecte la plateforme à partir des couleurs dominantes du screenshot.
  /// Bolt = vert (#34BB78), Heetch = rose/violet (#FF3B80), Uber = fond clair gris/blanc.
  func detectPlatformByColor(image: UIImage) -> ScanPlatform {
    guard let cgImage = image.cgImage else { return .UNKNOWN }
    let w = min(cgImage.width, 120)
    let h = min(cgImage.height, 200)
    guard let context = CGContext(
      data: nil, width: w, height: h,
      bitsPerComponent: 8, bytesPerRow: w * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return .UNKNOWN }
    context.draw(cgImage, in: CGRect(x: 0, y: 0, width: w, height: h))
    guard let data = context.data else { return .UNKNOWN }
    let ptr = data.bindMemory(to: UInt8.self, capacity: w * h * 4)

    var greenCount = 0
    var pinkCount = 0
    var lightCount = 0
    let total = w * h

    for i in 0..<total {
      let off = i * 4
      let r = Int(ptr[off]), g = Int(ptr[off+1]), b = Int(ptr[off+2])
      // Bolt green: high green, low red, moderate blue
      if g > 140 && g > r + 30 && g > b + 20 && r < 120 { greenCount += 1 }
      // Heetch pink/magenta: high red, low green, moderate-high blue
      if r > 180 && g < 100 && b > 80 { pinkCount += 1 }
      // Uber light: all channels > 200 (white/light gray)
      if r > 200 && g > 200 && b > 200 { lightCount += 1 }
    }

    let threshold = Double(total) * 0.08
    if Double(greenCount) > threshold { return .BOLT }
    if Double(pinkCount) > threshold { return .HEETCH }
    if Double(lightCount) > Double(total) * 0.35 { return .UBER }
    return .UNKNOWN
  }

  // MARK: - Fare scoring (mirror Android)

  private func extractFare(blocks: [OcrTextBlock], platform: ScanPlatform, screenHeight: Int) -> Double? {
    struct Candidate { let value: Double; let score: Float }
    let anchors = priceAnchors[platform] ?? priceAnchors[.UNKNOWN]!
    var candidates: [Candidate] = []

    for (idx, block) in blocks.enumerated() {
      let normalized = normalizeOcrDigits(block.text)
      if matches(normalized, pattern: "proposer", caseInsensitive: true) { continue }
      let blockLower = block.text.lowercased()
      if blockLower.contains("★") || blockLower.contains("⭐") || blockLower.contains("star")
        || blockLower.contains("étoile") || blockLower.contains("etoile")
        || blockLower.contains("rating") || blockLower.contains("note") { continue }

      let nsNorm = normalized as NSString
      var value: Double?
      var isWhole = false

      if let m = Self.priceRegex.firstMatch(in: normalized, range: NSRange(location: 0, length: nsNorm.length)) {
        let intPart = nsNorm.substring(with: m.range(at: 1)).replacingOccurrences(of: " ", with: "")
        let decPart = nsNorm.substring(with: m.range(at: 2)).replacingOccurrences(of: " ", with: "")
        value = Double("\(intPart).\(decPart)")
      } else if let m = Self.priceWholeRegex.firstMatch(in: normalized, range: NSRange(location: 0, length: nsNorm.length)) {
        let intPart = nsNorm.substring(with: m.range(at: 1)).replacingOccurrences(of: " ", with: "")
        value = Double(intPart)
        isWhole = true
      }

      guard let v = value, v >= fareMin, v <= fareMax else { continue }

      var score: Float = 0
      score += Float(block.box.height) * 1.5
      let centerY = Float((block.box.top + block.box.bottom) / 2)
      if centerY < Float(screenHeight) * 0.55 { score += 30 }
      if blockLower.contains("€") || blockLower.contains("eur") { score += 20 }
      if isWhole { score -= 10 }
      if matches(blockLower, pattern: #"course\s+de"#) { score -= 30 }

      if anchors.contains(where: { blockLower.contains($0) }) { score += 25 }
      if idx > 0, anchors.contains(where: { blocks[idx - 1].text.lowercased().contains($0) }) {
        score += 35
      }
      if idx < blocks.count - 1,
         anchors.contains(where: { blocks[idx + 1].text.lowercased().contains($0) }) {
        score += 20
      }
      if v >= 1.0 && v <= 5.0 { score -= 40 }
      candidates.append(Candidate(value: v, score: score))
    }

    return candidates.max(by: { $0.score < $1.score })?.value
  }

  private func locateFareBlockY(blocks: [OcrTextBlock], fare: Double) -> Int? {
    let euros = Int(fare)
    let cents = Int((fare - Double(euros)) * 100)
    let patterns = [
      String(format: "%d,%02d", euros, cents),
      String(format: "%d.%02d", euros, cents),
    ]
    return blocks.first(where: { b in patterns.contains(where: { b.text.contains($0) }) })?.box.centerY
  }

  // MARK: - Distance extraction

  private func extractDistance(blocks: [OcrTextBlock], pickupAddr: OcrTextBlock?, destAddr: OcrTextBlock?) -> Double? {
    struct Cand { let value: Double; let y: Int; let isPickupCombo: Bool }
    var candidates: [Cand] = []

    for block in blocks {
      let normalized = normalizeOcrDigits(block.text)
      let nsNorm = normalized as NSString
      guard let m = Self.distanceRegex.firstMatch(
        in: normalized, range: NSRange(location: 0, length: nsNorm.length)
      ) else { continue }
      let raw = nsNorm.substring(with: m.range(at: 1))
      var value = Double(cleanNum(raw)) ?? -1

      // Stitching fragmenté ML Kit (intra + inter)
      if !raw.contains(".") && !raw.contains(",") {
        if let intra = tryIntraBlockStitch(blockText: normalized, rawInt: raw) {
          value = intra
        } else if let inter = tryStitchFragmentedDistance(blocks: blocks, current: block, rawInt: raw) {
          value = inter
        }
      }

      if value < distMin || value > distMax { continue }
      let isPickupCombo = matches(block.text, pattern: "min", caseInsensitive: true)
      candidates.append(Cand(value: value, y: block.box.centerY, isPickupCombo: isPickupCombo))
    }

    if !candidates.isEmpty {
      // 1. Zone course (entre adresses)
      if let pickup = pickupAddr, let dest = destAddr {
        let yMin = pickup.box.top - 10
        let yMax = dest.box.bottom + 10
        let inCourse = candidates.filter { !$0.isPickupCombo && $0.y >= yMin && $0.y <= yMax }
        if !inCourse.isEmpty {
          return inCourse.max(by: { $0.value < $1.value })?.value
        }
      }
      // 2. Fallback : exclure combos pickup
      let nonPickup = candidates.filter { !$0.isPickupCombo }
      let pool = nonPickup.isEmpty ? candidates : nonPickup
      return pool.max(by: { $0.value < $1.value })?.value
    }

    // 3. Fallback legacy : "X,X" près d'un bloc avec "km"
    for block in blocks {
      let lower = block.text.lowercased()
      if !distanceAnchors.contains(where: { lower.contains($0) }) { continue }
      guard let regex = try? NSRegularExpression(pattern: #"(\d+[.,]\d)"#),
            let m = regex.firstMatch(in: block.text, range: NSRange(block.text.startIndex..., in: block.text))
      else { continue }
      let nsText = block.text as NSString
      let raw = nsText.substring(with: m.range(at: 1)).replacingOccurrences(of: ",", with: ".")
      if let v = Double(raw), v >= distMin, v <= distMax { return v }
    }
    return nil
  }

  private func tryIntraBlockStitch(blockText: String, rawInt: String) -> Double? {
    let cleanedRaw = rawInt.replacingOccurrences(of: " ", with: "")
    guard let regex = try? NSRegularExpression(
      pattern: #"(\d{1,3})\s+(\d{1,2})\s*km"#, options: .caseInsensitive
    ) else { return nil }
    let nsText = blockText as NSString
    let matches = regex.matches(in: blockText, range: NSRange(location: 0, length: nsText.length))
    for m in matches {
      let a = nsText.substring(with: m.range(at: 1))
      let b = nsText.substring(with: m.range(at: 2)).replacingOccurrences(of: " ", with: "")
      if b != cleanedRaw { continue }
      if let stitched = Double("\(a).\(b)"), stitched >= distMin, stitched <= distMax {
        return stitched
      }
    }
    return nil
  }

  private func tryStitchFragmentedDistance(blocks: [OcrTextBlock], current: OcrTextBlock, rawInt: String) -> Double? {
    let curCenterY = current.box.centerY
    let curLeft = current.box.left
    let curHeight = current.box.height
    let cleanedRaw = rawInt.replacingOccurrences(of: " ", with: "")

    for other in blocks {
      // Pas de comparaison avec soi-même
      if other.box.left == current.box.left && other.box.top == current.box.top { continue }
      let rowTol = max(other.box.height, curHeight) * 3 / 2
      if abs(other.box.centerY - curCenterY) > rowTol { continue }
      if other.box.right > curLeft + 20 { continue }

      // Strict : "NN." ou "NN,"
      if let regex = try? NSRegularExpression(pattern: #"(\d{1,3})\s*[.,]\s*$"#),
         let m = regex.firstMatch(in: other.text, range: NSRange(other.text.startIndex..., in: other.text)) {
        let nsText = other.text as NSString
        let prefix = nsText.substring(with: m.range(at: 1))
        if let stitched = Double("\(prefix).\(cleanedRaw)"), stitched >= distMin, stitched <= distMax {
          return stitched
        }
      }

      // Permissif : seulement si rawInt 1 chiffre
      if cleanedRaw.count == 1,
         let regex = try? NSRegularExpression(pattern: #"(\d{1,3})\s*$"#),
         let m = regex.firstMatch(in: other.text, range: NSRange(other.text.startIndex..., in: other.text)) {
        let nsText = other.text as NSString
        let prefix = nsText.substring(with: m.range(at: 1))
        if let stitched = Double("\(prefix).\(cleanedRaw)"), stitched >= distMin, stitched <= distMax {
          return stitched
        }
      }
    }
    return nil
  }

  // MARK: - Duration extraction

  private func extractDuration(blocks: [OcrTextBlock], pickupAddr: OcrTextBlock?, destAddr: OcrTextBlock?) -> Int? {
    struct Cand { let value: Int; let y: Int; let isPickupCombo: Bool }
    var candidates: [Cand] = []

    for block in blocks {
      let lower = block.text.lowercased()
      let hasKm = matches(lower, pattern: "km", caseInsensitive: false)
      let hasMin = matches(lower, pattern: "min", caseInsensitive: false)
      let isPickupCombo = hasKm && hasMin

      if hasKm && !hasMin && !matches(lower, pattern: "h", caseInsensitive: false) { continue }
      let normalized = normalizeOcrDigits(block.text)
      let nsNorm = normalized as NSString

      if let mH = Self.durationHourRegex.firstMatch(in: normalized, range: NSRange(location: 0, length: nsNorm.length)) {
        let hours = Int(nsNorm.substring(with: mH.range(at: 1))) ?? 0
        let mins = mH.range(at: 2).location != NSNotFound ? (Int(nsNorm.substring(with: mH.range(at: 2))) ?? 0) : 0
        let total = hours * 60 + mins
        if total >= 1 && total <= 300 {
          candidates.append(Cand(value: total, y: block.box.centerY, isPickupCombo: isPickupCombo))
          continue
        }
      }

      guard let m = Self.durationRegex.firstMatch(
        in: normalized, range: NSRange(location: 0, length: nsNorm.length)
      ) else { continue }
      let raw = nsNorm.substring(with: m.range(at: 1))
      guard let value = Int(raw), value >= 1, value <= 180 else { continue }
      candidates.append(Cand(value: value, y: block.box.centerY, isPickupCombo: isPickupCombo))
    }

    if candidates.isEmpty { return nil }
    if let pickup = pickupAddr, let dest = destAddr {
      let yMin = pickup.box.top - 10
      let yMax = dest.box.bottom + 10
      let inCourse = candidates.filter { !$0.isPickupCombo && $0.y >= yMin && $0.y <= yMax }
      if !inCourse.isEmpty { return inCourse.first?.value }
    }
    let nonPickup = candidates.filter { !$0.isPickupCombo }
    let pool = nonPickup.isEmpty ? candidates : nonPickup
    return pool.first?.value
  }

  // MARK: - Pickup combo extraction

  private func extractPickupInfo(blocks: [OcrTextBlock], courseDistanceKm: Double) -> (Int, Double)? {
    struct PickupMatch { let durationMin: Int; let distanceKm: Double; let y: Int }
    var matchesArr: [PickupMatch] = []

    for block in blocks {
      let text = normalizeOcrDigits(block.text)
      let nsText = text as NSString
      var minVal: Int?
      var kmVal: Double?

      if let m = Self.pickupComboMinFirst.firstMatch(in: text, range: NSRange(location: 0, length: nsText.length)) {
        let mins = nsText.substring(with: m.range(at: 1)).replacingOccurrences(of: " ", with: "")
        let kms = nsText.substring(with: m.range(at: 2))
        minVal = Int(mins)
        kmVal = Double(cleanNum(kms))
      }
      if minVal == nil || kmVal == nil {
        if let m = Self.pickupComboKmFirst.firstMatch(in: text, range: NSRange(location: 0, length: nsText.length)) {
          let kms = nsText.substring(with: m.range(at: 1))
          let mins = nsText.substring(with: m.range(at: 2)).replacingOccurrences(of: " ", with: "")
          kmVal = Double(cleanNum(kms))
          minVal = Int(mins)
        }
      }

      guard let mv = minVal, let kv = kmVal else { continue }
      if mv < 1 || mv > 60 { continue }
      if kv < 0.1 || kv > 30.0 { continue }
      if abs(kv - courseDistanceKm) < 0.1 { continue }
      matchesArr.append(PickupMatch(durationMin: mv, distanceKm: kv, y: block.box.centerY))
    }

    guard let best = matchesArr.sorted(by: { $0.y < $1.y }).first else { return nil }
    return (best.durationMin, best.distanceKm)
  }

  // MARK: - Address extraction

  private func isAddressBlock(_ block: OcrTextBlock, screenHeight: Int) -> Bool {
    let text = block.text.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
    if text.count < 8 || text.count > 80 { return false }
    if matches(text, pattern: #"course\s+de"#) { return false }
    if matches(text, pattern: #"\d[.,\s]*\d*\s*km\b"#) { return false }
    if matches(text, pattern: #"\d\s*min\b"#) { return false }
    if nonAddressWords.contains(text) { return false }
    if matches(text, pattern: #"\b(uber\w*|bolt\w*|heetch\w*)\b"#) { return false }

    // 1. Mots de voie en mot entier
    for kw in addressStreetKeywords {
      let escaped = NSRegularExpression.escapedPattern(for: kw)
      if matches(text, pattern: "(?<![a-zà-üß])\(escaped)(?![a-zà-üß])", caseInsensitive: true) {
        return true
      }
    }
    // 2. Suffixes DE
    for suf in addressStreetSuffixes {
      let escaped = NSRegularExpression.escapedPattern(for: suf)
      if matches(text, pattern: "[a-zà-üß]+\(escaped)(?![a-zà-üß])", caseInsensitive: true) {
        return true
      }
    }
    // 3. Digit-first FR/UK
    if matches(text, pattern: #"^\d{1,4}\s+[a-zà-ü]{5,}"#) { return true }
    // 4. Word-then-digit DE/ES/IT
    if matches(text, pattern: #"[a-zà-üß]{5,}[\s,]+\d{1,4}\s*$"#) { return true }
    return false
  }

  private func findAddressBlocks(blocks: [OcrTextBlock], screenHeight: Int, fareBlockY: Int?) -> [OcrTextBlock] {
    var candidates = blocks
      .filter { $0.box.centerY > Int(Double(screenHeight) * 0.25) }
      .filter { isAddressBlock($0, screenHeight: screenHeight) }
      .sorted { $0.box.centerY < $1.box.centerY }

    if let fareY = fareBlockY {
      let slackAbove = Int(Double(screenHeight) * 0.05)
      let depthBelow = Int(Double(screenHeight) * 0.5)
      let yMin = fareY - slackAbove
      let yMax = fareY + depthBelow
      candidates = candidates.filter { $0.box.centerY >= yMin && $0.box.centerY <= yMax }
    }

    if candidates.count > 2 {
      let metricYs: [Int] = blocks.compactMap { b in
        matches(b.text, pattern: #"\d+\s*[.,]?\s*\d*\s*(?:km|min)\b"#, caseInsensitive: true)
          ? b.box.centerY : nil
      }
      if !metricYs.isEmpty {
        let radius = max(Int(Double(screenHeight) * 0.15), 300)
        candidates = candidates.filter { b in
          metricYs.contains(where: { abs($0 - b.box.centerY) <= radius })
        }
      }
    }
    return dedupOverlappingAddresses(candidates)
  }

  private func dedupOverlappingAddresses(_ candidates: [OcrTextBlock]) -> [OcrTextBlock] {
    let texts = candidates.map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }
    return candidates.enumerated().compactMap { (i, b) in
      let mine = texts[i]
      let hasLonger = candidates.indices.contains { j in
        j != i && texts[j].count > mine.count && texts[j].hasPrefix(mine)
      }
      return hasLonger ? nil : b
    }
  }

  private func mergeAddressContinuation(addrBlock: OcrTextBlock, allBlocks: [OcrTextBlock], screenHeight: Int) -> String {
    let addrBox = addrBlock.box
    let baseText = addrBlock.text.trimmingCharacters(in: .whitespacesAndNewlines)

    let continuation = allBlocks.first { other in
      if other.box.left == addrBox.left && other.box.top == addrBox.top { return false }
      let ob = other.box
      if ob.top <= addrBox.top { return false }
      if ob.top - addrBox.bottom > addrBox.height { return false }
      let xOverlap = min(addrBox.right, ob.right) - max(addrBox.left, ob.left)
      let minWidth = min(addrBox.width, ob.width)
      if Double(xOverlap) < Double(minWidth) * 0.5 { return false }
      let t = other.text.trimmingCharacters(in: .whitespacesAndNewlines)
      if t.isEmpty || t.count > 60 { return false }
      if matches(t, pattern: #"\d\s*(?:km|min)\b"#, caseInsensitive: true) { return false }
      if matches(t, pattern: #"^\d{1,4}\s+[A-Za-zà-üÀ-Ü]"#) { return false }
      if isAddressBlock(other, screenHeight: screenHeight) { return false }
      return true
    }

    guard let cont = continuation else { return baseText }
    let contText = cont.text.trimmingCharacters(in: .whitespacesAndNewlines)
    return baseText.hasSuffix("-") ? "\(baseText)\(contText)" : "\(baseText)\n\(contText)"
  }

  // MARK: - Sanity

  private func isSane(fare: Double, distanceKm: Double) -> Bool {
    if fare < fareMin || fare > fareMax { return false }
    if distanceKm < distMin || distanceKm > distMax { return false }
    let rate = fare / distanceKm
    if rate < rateMin || rate > rateMax { return false }
    return true
  }

  // MARK: - Helpers

  private func matches(_ text: String, pattern: String, caseInsensitive: Bool = false) -> Bool {
    let opts: NSRegularExpression.Options = caseInsensitive ? [.caseInsensitive] : []
    guard let regex = try? NSRegularExpression(pattern: pattern, options: opts) else { return false }
    return regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
  }
}

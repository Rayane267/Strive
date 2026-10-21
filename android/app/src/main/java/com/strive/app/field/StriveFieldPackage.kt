package com.strive.field

import android.graphics.Color
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.uimanager.annotations.ReactProp
import kotlin.math.roundToInt

/** Le champ derrière les écrans (`ScreenField.android.tsx`). */
class StriveFieldManager : SimpleViewManager<StriveFieldView>() {
    override fun getName() = "StriveField"
    override fun createViewInstance(ctx: ThemedReactContext) = StriveFieldView(ctx, fade = false)
}

/** Le fondu au-dessus de la capsule d'onglets (`TabNavigator`). Deux noms et non
 *  une prop : chaque nom ne s'enregistre qu'une fois côté JS. */
class StriveFieldFadeManager : SimpleViewManager<StriveFieldView>() {
    override fun getName() = "StriveFieldFade"
    override fun createViewInstance(ctx: ThemedReactContext) = StriveFieldView(ctx, fade = true)

    @ReactProp(name = "fadeLength")
    fun setFadeLength(view: StriveFieldView, dp: Float) {
        view.fadeLengthPx = PixelUtil.toPixelFromDIP(dp).roundToInt()
    }
}

/** Une pile de dégradés donnée par le JS (`AndroidAuthField.tsx`). */
class StriveGradientStackManager : SimpleViewManager<StriveGradientStackView>() {
    override fun getName() = "StriveGradientStack"
    override fun createViewInstance(ctx: ThemedReactContext) = StriveGradientStackView(ctx)

    /** De la couche du dessous à celle du dessus :
     *  linéaire `{ colors: [argb…], locations: [0…1…], start: {x, y}, end: {x, y} }`,
     *  ronde `{ type: 'radial', colors, locations, center: {x, y}, radius: {x, y} }`. */
    @ReactProp(name = "layers")
    fun setLayers(view: StriveGradientStackView, layers: ReadableArray?) {
        val list = ArrayList<GradientLayer>()
        if (layers != null) {
            for (i in 0 until layers.size()) {
                val m = layers.getMap(i) ?: continue
                val colors = m.getArray("colors") ?: continue
                val locations = m.getArray("locations") ?: continue
                val argb = IntArray(colors.size()) { colors.getInt(it) }
                val locs = FloatArray(locations.size()) { locations.getDouble(it).toFloat() }
                if (m.hasKey("type") && m.getString("type") == "radial") {
                    val center = m.getMap("center") ?: continue
                    val radius = m.getMap("radius") ?: continue
                    val cx = center.getDouble("x").toFloat()
                    val cy = center.getDouble("y").toFloat()
                    list.add(
                        GradientLayer(
                            argb, locs, cx, cy, cx, cy,
                            radial = true,
                            rx = radius.getDouble("x").toFloat(),
                            ry = radius.getDouble("y").toFloat(),
                        ),
                    )
                } else {
                    val start = m.getMap("start") ?: continue
                    val end = m.getMap("end") ?: continue
                    list.add(
                        GradientLayer(
                            argb, locs,
                            start.getDouble("x").toFloat(),
                            start.getDouble("y").toFloat(),
                            end.getDouble("x").toFloat(),
                            end.getDouble("y").toFloat(),
                        ),
                    )
                }
            }
        }
        view.setLayers(list)
    }

    @ReactProp(name = "backdrop", customType = "Color")
    fun setBackdrop(view: StriveGradientStackView, color: Int?) {
        view.setBackdrop(color ?: Color.BLACK)
    }
}

class StriveFieldPackage : ReactPackage {
    override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> = emptyList()

    override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> =
        listOf(StriveFieldManager(), StriveFieldFadeManager(), StriveGradientStackManager())
}

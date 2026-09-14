import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { stroke, strokeWidth } from '../theme/stroke';
import { hapticLight } from '../utils/haptics';

export type NetworkDirection = 'offer' | 'receive';

/**
 * Le sens du réseau, en un geste.
 *
 * Les deux écrans sont deux moitiés d'un même mécanisme : ce que l'un publie,
 * l'autre le reçoit. Les ranger dans deux entrées de menu séparées les aurait
 * fait lire comme deux fonctionnalités sans rapport. Ici, passer de l'une à
 * l'autre est le même geste que changer de lecture sur une grille — le rail et
 * le curseur des Meilleurs créneaux, pour qu'on reconnaisse l'objet.
 *
 * Le curseur ne glisse pas : l'écran est remplacé sous lui, il n'y a aucune
 * continuité à mimer. Une animation de 280 ms sur un objet qui disparaît en 10
 * serait un mensonge de plus, pas une transition.
 */
const NetworkDirectionSwitch = ({
  active,
  onSwitch,
}: {
  active: NetworkDirection;
  onSwitch: (direction: NetworkDirection) => void;
}) => {
  const { t } = useTranslation();

  const cell = (dir: NetworkDirection, icon: string) => {
    const on = active === dir;
    return (
      <TouchableOpacity
        key={dir}
        style={[styles.cell, on && styles.cellOn]}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        onPress={() => {
          if (on) return;
          hapticLight();
          onSwitch(dir);
        }}
      >
        <Feather
          name={icon}
          size={15}
          color={on ? colors.textMain : 'rgba(255,255,255,0.42)'}
        />
        <Text style={[styles.label, on && styles.labelOn]}>
          {t(`rideNetwork.tab.${dir}`)}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.row}>
      {cell('offer', 'arrow-up-right')}
      {cell('receive', 'arrow-down-left')}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    padding: space.xs,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
  },
  cell: {
    flex: 1,
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.full,
  },
  cellOn: {
    backgroundColor: 'rgba(0,230,118,0.20)',
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
  },
  label: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 13.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  labelOn: { color: colors.textMain },
});

export default NetworkDirectionSwitch;

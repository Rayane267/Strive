import React from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  GestureResponderEvent,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors } from '../theme/colors';

interface ScanButtonProps {
  onPress?: (event: GestureResponderEvent) => void;
}

const ScanButton = React.memo(({ onPress }: ScanButtonProps) => (
  <TouchableOpacity
    style={styles.container}
    onPress={onPress}
    activeOpacity={0.8}
  >
    <View style={styles.button}>
      <MaterialCommunityIcons
        name="camera-plus-outline"
        size={30}
        color={colors.primaryInk}
      />
    </View>
  </TouchableOpacity>
));

const styles = StyleSheet.create({
  container: {
    top: -20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  button: {
    width: 65,
    height: 65,
    borderRadius: 35,
    backgroundColor: colors.background,
    borderColor: colors.primary,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
});

export default ScanButton;

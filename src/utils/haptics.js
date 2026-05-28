import * as Haptics from 'expo-haptics';

// Jemná haptika pre bežné interakcie v UI.
// Guardy držia appku stabilnú aj keď zariadenie/výnimka haptiku nepodporí.

export async function hapticPress() {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // no-op
  }
}

// Prepínače tabov / segmentov – jemnejší „tik“ ako pri impact.

export async function hapticSelection() {
  try {
    await Haptics.selectionAsync();
  } catch {
    // no-op
  }
}

export async function hapticSuccess() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // no-op
  }
}


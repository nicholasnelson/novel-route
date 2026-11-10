package app.novelroute.testlab

import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Whether the app is running on a Firebase Test Lab device, as Google Play's pre-launch report
 * uses. Test Lab sets this system setting (https://firebase.google.com/docs/test-lab/android/android-studio#modify_instrumented_test_behavior_for).
 */
class TestLabModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TestLab")

    Function("isTestLab") {
      val context = appContext.reactContext ?: return@Function false
      Settings.System.getString(context.contentResolver, "firebase.test.lab") == "true"
    }
  }
}

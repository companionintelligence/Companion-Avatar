package computer.ci.avatar;

import android.content.res.Configuration;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // SystemBars applies its own icon colour from a task it posts to the main thread, so ours
    // is queued behind it. Set directly, it would be overwritten.
    @Override
    public void onResume() {
        super.onResume();
        getWindow().getDecorView().post(this::useLightBarIcons);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        getWindow().getDecorView().post(this::useLightBarIcons);
    }

    // The web app is dark only, and the navy window shows through the status and gesture bars.
    // Their icons therefore have to be light, whatever the system theme says.
    private void useLightBarIcons() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }
}

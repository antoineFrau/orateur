import Quickshell
import Quickshell.Wayland
import Quickshell.Hyprland
import QtQuick

PanelWindow {
    id: orateurPanel

    // One layer surface on the Hyprland-focused output; falls back to the first screen.
    readonly property var panelScreen: {
        const screens = Quickshell.screens
        const n = screens.length
        if (n === 0)
            return null
        const fm = Hyprland.focusedMonitor
        if (fm) {
            for (let i = 0; i < n; i++) {
                if (screens[i].name === fm.name)
                    return screens[i]
            }
        }
        for (let i = 0; i < n; i++) {
            const mon = Hyprland.monitorFor(screens[i])
            if (mon && mon.focused)
                return screens[i]
        }
        return screens[0]
    }

    screen: panelScreen

    // Some compositors never map layer surfaces that start visible:false; keep mapped
    // and collapse height when idle so the bar still appears on first recording.
    visible: panelScreen !== null
    color: "transparent"
    WlrLayershell.namespace: "quickshell:orateur"
    WlrLayershell.layer: WlrLayer.Overlay
    exclusionMode: ExclusionMode.Ignore
    exclusiveZone: 0
    anchors {
        left: true
        bottom: true
        right: true
    }
    implicitWidth: 380
    implicitHeight: orateurWidget.isActive ? 48 : 0
    margins {
        left: panelScreen ? (panelScreen.width - 380) / 2 : 0
        right: panelScreen ? (panelScreen.width - 380) / 2 : 0
        bottom: 24
    }

    OrateurWidget {
        id: orateurWidget
        anchors.fill: parent
        runDemoOnLoad: false
    }
}

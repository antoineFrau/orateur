import Quickshell
import Quickshell.Wayland
import QtQuick

Variants {
    model: Quickshell.screens

    PanelWindow {
        required property var modelData
        screen: modelData

        // Some compositors never map layer surfaces that start visible:false; keep mapped
        // and collapse height when idle so the bar still appears on first recording.
        visible: true
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
            left: (modelData.width - 380) / 2
            right: (modelData.width - 380) / 2
            bottom: 24
        }

        OrateurWidget {
            id: orateurWidget
            anchors.fill: parent
            runDemoOnLoad: false
        }
    }
}

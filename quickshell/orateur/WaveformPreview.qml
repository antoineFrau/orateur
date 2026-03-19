import QtQuick

Row {
    id: root
    property var levels: []
    property int barCount: 60
    property real barWidth: 2
    property real barSpacing: 1
    property real maxBarHeight: 20
    property color barColor: "#6b7280"

    spacing: barSpacing
    height: maxBarHeight

    Repeater {
        model: root.levels.length > 0 ? root.levels : root.barCount
        Rectangle {
            width: root.barWidth
            height: Math.max(2, (root.levels.length > 0 ? (modelData || 0) : 0) * root.maxBarHeight)
            anchors.verticalCenter: parent.verticalCenter
            color: root.barColor
            radius: 1
        }
    }
}

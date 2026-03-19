import Quickshell
import Quickshell.Io
import QtQuick

Item {
    id: root

    // High-level UI mode for styling (State { when: ... } or bindings):
    //   idle — bar hidden / inactive (except showAfterDone).
    //   record — mic capture; use recordKind "stt" | "sts" for STT vs STS recording.
    //   stt    — transcribe-only path after mic (until transcribed / error).
    //   tts    — read-aloud (shortcut speak / FIFO speak), not part of STS.
    //   sts    — after STS mic stop through LLM + TTS (until tts_done / error).
    property string uiState: "idle"
    // Meaningful when uiState === "" (from recording_started mode).
    property string recordKind: ""
    // TTS sub-phase for UI: idle | synthesize | play (standalone TTS and STS playback).
    property string ttsPhase: "idle"

    property bool recording: false
    property real recordingStartTime: 0
    property int recordingTimeTick: 0
    property var waveformLevels: []

    property bool simulateRecording: false
    property string simulateRecordKind: "stt"
    property real simulateStartTime: 0
    property var simulatedLevels: []
    property bool runDemoOnLoad: false
    property real ttsDurationSec: 0
    property var ttsLevels: []
    property string statusText: "Idle"
    property string transcribedText: ""

    property string fifoPath: "~/.cache/orateur/cmd.fifo"

    property bool _stsPipelineActive: false
    property real _ttsPlayStartedAt: 0
    property int ttsCountdownTick: 0

    // Events come from ~/.cache/orateur/ui_events.jsonl (written by orateur run).
    readonly property string _uiEventsTailSh:
        "mkdir -p \"$HOME/.cache/orateur\" && " +
        "(test -f \"$HOME/.cache/orateur/ui_events.jsonl\" || : > \"$HOME/.cache/orateur/ui_events.jsonl\") && " +
        "exec tail -n0 -F \"$HOME/.cache/orateur/ui_events.jsonl\""

    function sendCommand(cmd) {
        var json = JSON.stringify(cmd)
        var delim = "ORATEUR_" + Math.random().toString(36).slice(2)
        sendProc.command = ["sh", "-c", "printf '%s\\n' '" + json.replace(/'/g, "'\"'\"'") + "' >> " + fifoPath]
        sendProc.running = true
    }

    function parseEvent(line) {
        try {
            var obj = JSON.parse(line)
            var ev = obj.event
            if (ev === "recording_started") {
                root._stsPipelineActive = false
                root.ttsPhase = "idle"
                root._ttsPlayStartedAt = 0
                root.recording = true
                root.recordKind = obj.mode || "stt"
                root.uiState = "record"
                root.recordingStartTime = Date.now() / 1000
                root.waveformLevels = []
                root.statusText = "Recording..."
            } else if (ev === "recording") {
                if (obj.level !== undefined) {
                    var arr = root.waveformLevels.slice()
                    arr.push(obj.level)
                    if (arr.length > 60) arr.shift()
                    root.waveformLevels = arr
                }
            } else if (ev === "recording_stopped") {
                root.recording = false
                root.recordingTimeTick = 0
                if (root.recordKind === "sts") {
                    root._stsPipelineActive = true
                    root.uiState = "sts"
                } else {
                    root.uiState = "stt"
                }
                if (obj.levels && obj.levels.length > 0) {
                    root.waveformLevels = obj.levels
                }
                root.statusText = "Processing..."
            } else if (ev === "transcribing") {
                root.statusText = "Transcribing..."
            } else if (ev === "transcribed") {
                root.transcribedText = obj.text || ""
                if (root._stsPipelineActive) {
                    root.statusText = "Processing..."
                } else {
                    root.statusText = root.transcribedText ? "Done" : "Idle"
                    root.uiState = "idle"
                    root.recordKind = ""
                    root.showAfterDone = true
                    hideAfterDoneTimer.restart()
                }
            } else if (ev === "tts_estimate") {
                root.ttsPhase = "synthesize"
                root._ttsPlayStartedAt = 0
                root.ttsDurationSec = obj.duration_sec || 0
                root.ttsLevels = []
                root.statusText = "Synthesizing..."
                if (!root._stsPipelineActive)
                    root.uiState = "tts"
            } else if (ev === "tts_playing") {
                root.ttsPhase = "play"
                root._ttsPlayStartedAt = Date.now() / 1000
                root.statusText = "Playing..."
                if (root._stsPipelineActive)
                    root.uiState = "sts"
                else
                    root.uiState = "tts"
            } else if (ev === "tts_level") {
                var ttsArr = root.ttsLevels.slice()
                ttsArr.push(obj.level || 0)
                root.ttsLevels = ttsArr
            } else if (ev === "tts_done") {
                root.ttsPhase = "idle"
                root._ttsPlayStartedAt = 0
                root.ttsDurationSec = 0
                root.ttsLevels = []
                root.statusText = "Idle"
                root._stsPipelineActive = false
                root.recordKind = ""
                root.uiState = "idle"
                root.showAfterDone = true
                hideAfterDoneTimer.restart()
            } else if (ev === "error") {
                root.ttsPhase = "idle"
                root._ttsPlayStartedAt = 0
                root.statusText = "Error: " + (obj.message || "unknown")
                root.recording = false
                root._stsPipelineActive = false
                root.recordKind = ""
                root.uiState = "idle"
                root.showAfterDone = true
                hideAfterDoneTimer.restart()
            }
        } catch (e) {
            console.warn("Parse error:", e, line)
        }
    }

    Process {
        id: eventSourceProc
        command: ["sh", "-c", root._uiEventsTailSh]
        running: true
        stdout: SplitParser {
            splitMarker: "\n"
            onRead: root.parseEvent(data)
        }
        onRunningChanged: {
            if (!running) {
                root.statusText = "UI events stopped"
            }
        }
    }

    Process {
        id: sendProc
        command: ["sh", "-c", "true"]
        running: false
    }

    property bool showRecording: root.recording || root.simulateRecording
    readonly property bool showTtsChrome: root.ttsPhase !== "idle"
    property var displayLevels: root.simulateRecording ? root.simulatedLevels : (root.recording ? root.waveformLevels : (root.ttsLevels.length > 0 ? root.ttsLevels : root.waveformLevels))

    // Panel visible whenever not idle, or briefly after done/error
    property bool isActive: root.uiState !== "idle" || root.simulateRecording ||
        root.showAfterDone
    property bool showAfterDone: false
    property real displayStartTime: root.simulateRecording ? root.simulateStartTime : root.recordingStartTime

    Timer {
        running: root.showRecording
        repeat: true
        interval: 1000
        onTriggered: root.recordingTimeTick++
    }

    Timer {
        id: simulateStartTimer
        running: root.runDemoOnLoad
        repeat: false
        interval: 1500
        onTriggered: {
            root.simulateRecording = true
            root.recordKind = root.simulateRecordKind
            root.uiState = "record"
            root.simulateStartTime = Date.now() / 1000
            root.simulatedLevels = []
        }
    }

    Timer {
        id: simulateLevelTimer
        running: root.simulateRecording
        repeat: true
        interval: 80
        onTriggered: {
            var t = (Date.now() / 1000 - root.simulateStartTime) * 3
            var level = 0.3 + 0.4 * Math.sin(t) * Math.sin(t * 0.7) + 0.15 * (Math.random() - 0.5)
            level = Math.max(0.1, Math.min(1, level))
            var arr = root.simulatedLevels.slice()
            arr.push(level)
            if (arr.length > 60) arr.shift()
            root.simulatedLevels = arr
        }
    }

    Timer {
        id: simulateStopTimer
        running: root.simulateRecording
        repeat: false
        interval: 15000
        onTriggered: {
            root.simulateRecording = false
            if (!root.recording)
                root.uiState = "idle"
            if (!root.recording)
                root.recordKind = ""
        }
    }

    Timer {
        id: hideAfterDoneTimer
        interval: 2500
        repeat: false
        onTriggered: root.showAfterDone = false
    }

    Timer {
        running: root.ttsPhase === "play" && root._ttsPlayStartedAt > 0
        repeat: true
        interval: 200
        onTriggered: root.ttsCountdownTick++
    }

    Rectangle {
        anchors.fill: parent
        radius: 8
        color: "#2b2930"
        opacity: 0.95

        Item {
            id: barContent
            anchors.fill: parent
            anchors.margins: 8

            readonly property int sideSlotWidth: 40

            Item {
                id: leftSlot
                anchors.left: parent.left
                anchors.leftMargin: 4
                anchors.verticalCenter: parent.verticalCenter
                width: barContent.sideSlotWidth
                height: 24

                Rectangle {
                    id: pulseRect
                    anchors.centerIn: parent
                    visible: root.showRecording
                    width: 10
                    height: 10
                    radius: 5
                    color: "#ef4444"
                    opacity: 1
                    SequentialAnimation {
                        running: root.showRecording
                        loops: Animation.Infinite
                        NumberAnimation { target: pulseRect; property: "opacity"; from: 0.3; to: 1; duration: 600 }
                        NumberAnimation { target: pulseRect; property: "opacity"; from: 1; to: 0.3; duration: 600 }
                    }
                }
                Rectangle {
                    id: ttsDot
                    anchors.centerIn: parent
                    visible: root.showTtsChrome
                    width: 10
                    height: 10
                    radius: 5
                    color: root.ttsPhase === "synthesize" ? "#f59e0b" : "#22c55e"
                    opacity: 1
                    SequentialAnimation {
                        running: root.showTtsChrome
                        loops: Animation.Infinite
                        NumberAnimation { target: ttsDot; property: "opacity"; from: 0.35; to: 1; duration: 500 }
                        NumberAnimation { target: ttsDot; property: "opacity"; from: 1; to: 0.35; duration: 500 }
                    }
                }
            }

            WaveformPreview {
                id: waveform
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.verticalCenter: parent.verticalCenter
                levels: root.displayLevels
                barCount: 60
                barWidth: 2
                barSpacing: 1
                maxBarHeight: 20
                barColor: "#9ca3af"
            }

            Item {
                id: rightTimerBox
                anchors.right: parent.right
                anchors.rightMargin: 4
                anchors.verticalCenter: parent.verticalCenter
                width: barContent.sideSlotWidth + 10
                height: 24
                visible: root.showRecording || root.showTtsChrome

                Text {
                    id: rightTimer
                    anchors.fill: parent
                    anchors.leftMargin: 5
                    anchors.rightMargin: 6
                    anchors.topMargin: 3
                    anchors.bottomMargin: 3
                    font.pixelSize: 12
                    font.family: "monospace"
                    horizontalAlignment: Text.AlignRight
                    verticalAlignment: Text.AlignVCenter
                    color: root.showTtsChrome && root.ttsPhase === "synthesize" ? "#78716c" : "#cac4d0"
                    text: {
                        if (root.showRecording) {
                            var _ = root.recordingTimeTick
                            var rsec = Math.floor(Date.now() / 1000 - root.displayStartTime)
                            var rm = Math.floor(rsec / 60)
                            var rs = rsec % 60
                            return rm + ":" + (rs < 10 ? "0" : "") + rs
                        }
                        if (root.showTtsChrome) {
                            if (root.ttsPhase === "synthesize")
                                return "--:--"
                            var _t = root.ttsCountdownTick
                            var elapsed = root._ttsPlayStartedAt > 0 ? (Date.now() / 1000 - root._ttsPlayStartedAt) : 0
                            var left = Math.ceil(root.ttsDurationSec - elapsed)
                            if (left < 0)
                                left = 0
                            var m = Math.floor(left / 60)
                            var s = left % 60
                            return m + ":" + (s < 10 ? "0" : "") + s
                        }
                        return ""
                    }
                }
            }
        }
    }
}

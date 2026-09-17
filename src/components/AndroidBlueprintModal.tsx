import React, { useState } from 'react';
import { Cpu, Copy, Check, X, FileCode, Layers, Shield } from 'lucide-react';

interface AndroidBlueprintModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AndroidBlueprintModal: React.FC<AndroidBlueprintModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'uiState' | 'faceCanvas' | 'viewModel' | 'manifest'>('faceCanvas');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const KOTLIN_SNIPPETS = {
    faceCanvas: `// UltronFaceCanvas.kt
package com.ultron.fp.ui.face

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.input.pointer.pointerInput
import com.ultron.fp.model.FaceState
import com.ultron.fp.model.UltronMode
import kotlin.math.*

private val CyanNeon = Color(0xFF05E1FF)
private val GoldAccent = Color(0xFFF5C542)
private val AmberWarn = Color(0xFFFFB648)
private val CrimsonAlert = Color(0xFFFF3B3B)

@Composable
fun UltronFaceCanvas(
    faceState: FaceState,
    mode: UltronMode,
    gazeX: Float,
    gazeY: Float,
    onTap: () => Unit,
    onDoubleTap: () => Unit,
    onLongPress: () => Unit,
    onSwipeUp: () => Unit,
    onSwipeDown: () => Unit,
    modifier: Modifier = Modifier
) {
    val infiniteTransition = rememberInfiniteTransition(label = "UltronLifeCycle")
    
    // Organic Breathing Cycle
    val breath by infiniteTransition.animateFloat(
        initialValue = 0.975f,
        targetValue = 1.025f,
        animationSpec = infiniteRepeatable(
            animation = tween(2800, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "breath"
    )

    // Dynamic Color Mapping
    val mainColor = when {
        faceState == FaceState.ANGRY || faceState == FaceState.FURY -> CrimsonAlert
        faceState == FaceState.CONCERNED -> AmberWarn
        mode == UltronMode.GOLD -> GoldAccent
        else -> CyanNeon
    }

    Canvas(
        modifier = modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { onTap() },
                    onDoubleTap = { onDoubleTap() },
                    onLongPress = { onLongPress() }
                )
            }
    ) {
        val cx = size.width / 2f
        val cy = size.height * 0.44f
        val r = min(size.width, size.height) * 0.155f
        val eyeDistance = r * 1.28f

        scale(scaleX = 1f / sqrt(breath), scaleY = breath, pivot = Offset(cx, cy)) {
            // Left Eye
            drawLivingEye(
                center = Offset(cx - eyeDistance, cy),
                radius = r,
                color = mainColor,
                face = faceState,
                gaze = Offset(gazeX, gazeY),
                isLeft = true
            )

            // Right Eye
            drawLivingEye(
                center = Offset(cx + eyeDistance, cy),
                radius = r,
                color = mainColor,
                face = faceState,
                gaze = Offset(gazeX, gazeY),
                isLeft = false
            )

            // Mode Accessories & Crown
            drawUltronCrown(
                center = Offset(cx, cy),
                radius = r,
                mode = mode,
                color = mainColor
            )

            // Reactive Viseme Mouth
            drawUltronMouth(
                center = Offset(cx, cy + r * 1.42f),
                width = r * 2.1f,
                face = faceState,
                color = mainColor
            )
        }
    }
}`,
    uiState: `// UltronUiState.kt
package com.ultron.fp.model

enum class FaceState {
    IDLE,
    LISTENING,
    THINKING,
    SPEAKING,
    HAPPY,
    CONCERNED,
    ANGRY,
    FURY,
    SLEEPING,
    STARTLE
}

enum class UltronMode {
    GUARDIAN,
    MINING,
    GOLD,
    CREATIVE,
    ANALYTICAL,
    STRATEGIC,
    EXPLORER
}

data class UltronUiState(
    val face: FaceState = FaceState.GUARDIAN_DEFAULT,
    val mode: UltronMode = UltronMode.GUARDIAN,
    val gazeX: Float = 0f,
    val gazeY: Float = 0f,
    val isListening: Boolean = false,
    val isSpeaking: Boolean = false,
    val speechBubbleText: String = "",
    val speechBubbleVisible: Boolean = false,
    val micEnabled: Boolean = true,
    val speakerEnabled: Boolean = true,
    val energyLevel: Int = 85,
    val isDockOpen: Boolean = false,
    val isSettingsOpen: Boolean = false,
    val pendingPermission: BoardPermissionRequest? = null
)

data class BoardPermissionRequest(
    val serviceKey: String,
    val title: String,
    val description: String,
    val payload: String
)`,
    viewModel: `// UltronViewModel.kt
package com.ultron.fp.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ultron.fp.model.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay

class UltronViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(UltronUiState())
    val uiState = _uiState.asStateFlow()

    fun onSingleTap() {
        if (_uiState.value.face == FaceState.SLEEPING) {
            wakeUp()
        } else {
            // Trigger quick attentive blink
            triggerBlink()
        }
    }

    fun onDoubleTapVoice() {
        viewModelScope.launch {
            _uiState.update { it.copy(face = FaceState.LISTENING, isListening = true) }
            speak("Te escucho.")
            delay(1500)
            _uiState.update { it.copy(face = FaceState.THINKING) }
            delay(1200)
            _uiState.update { it.copy(face = FaceState.SPEAKING) }
            speak("Anotado para la junta.")
            delay(2500)
            _uiState.update { it.copy(face = FaceState.IDLE, isListening = false) }
        }
    }

    fun switchMode(newMode: UltronMode) {
        _uiState.update { it.copy(mode = newMode) }
    }

    fun wakeUp() {
        _uiState.update { it.copy(face = FaceState.IDLE) }
        speak("De vuelta en línea.")
    }

    fun sleep() {
        _uiState.update { it.copy(face = FaceState.SLEEPING) }
        speak("Entrando en reposo.")
    }

    private fun speak(text: String) {
        _uiState.update { it.copy(speechBubbleText = text, speechBubbleVisible = true) }
        // Connect to Android TextToSpeech engine
    }
}`,
    manifest: `<!-- AndroidManifest.xml (Landscape Kiosk Fullscreen) -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.ultron.fp">

    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />

    <application
        android:label="ULTRON FP"
        android:theme="@android:style/Theme.NoTitleBar.Fullscreen"
        android:hardwareAccelerated="true">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:screenOrientation="landscape"
            android:configChanges="orientation|screenSize|keyboardHidden"
            android:immersive="true"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
                <category android:name="android.intent.category.HOME" />
                <category android:name="android.intent.category.DEFAULT" />
            </intent-filter>
        </activity>
    </application>
</manifest>`
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(KOTLIN_SNIPPETS[activeTab]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      id="ultron-android-blueprint-modal"
      className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="w-full max-w-4xl bg-[#05080c] border border-[#05E1FF]/40 rounded-xl p-6 shadow-[0_0_35px_rgba(5,225,255,0.25)] flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#05E1FF]/20 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#05E1FF]/10 border border-[#05E1FF]/30 flex items-center justify-center text-[#05E1FF]">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-mono tracking-[0.2em] text-[#8FA3B0] block uppercase">
                ARQUITECTURA ANDROID NATIVA · KOTLIN + JETPACK COMPOSE
              </span>
              <h3 className="font-display font-bold text-lg text-[#05E1FF] tracking-wider">
                MÓDULOS DE COMPILACIÓN NATIVA PARA STAND DE MESA
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[#8FA3B0] hover:text-[#05E1FF] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-[#05E1FF]/20 pb-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('faceCanvas')}
              className={`px-3 py-1.5 rounded text-xs font-mono flex items-center gap-1.5 transition-colors ${
                activeTab === 'faceCanvas'
                  ? 'bg-[#05E1FF] text-[#001418] font-bold'
                  : 'bg-black/40 text-[#8FA3B0] hover:text-[#05E1FF]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              UltronFaceCanvas.kt
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('uiState')}
              className={`px-3 py-1.5 rounded text-xs font-mono flex items-center gap-1.5 transition-colors ${
                activeTab === 'uiState'
                  ? 'bg-[#05E1FF] text-[#001418] font-bold'
                  : 'bg-black/40 text-[#8FA3B0] hover:text-[#05E1FF]'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              UltronUiState.kt
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('viewModel')}
              className={`px-3 py-1.5 rounded text-xs font-mono flex items-center gap-1.5 transition-colors ${
                activeTab === 'viewModel'
                  ? 'bg-[#05E1FF] text-[#001418] font-bold'
                  : 'bg-black/40 text-[#8FA3B0] hover:text-[#05E1FF]'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              UltronViewModel.kt
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('manifest')}
              className={`px-3 py-1.5 rounded text-xs font-mono flex items-center gap-1.5 transition-colors ${
                activeTab === 'manifest'
                  ? 'bg-[#05E1FF] text-[#001418] font-bold'
                  : 'bg-black/40 text-[#8FA3B0] hover:text-[#05E1FF]'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              AndroidManifest.xml
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="px-3 py-1.5 rounded border border-[#05E1FF]/40 text-[#05E1FF] hover:bg-[#05E1FF]/10 text-xs font-mono flex items-center gap-1"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copiado al portapapeles' : 'Copiar archivo'}
          </button>
        </div>

        {/* Code display */}
        <pre className="p-4 bg-black border border-[#05E1FF]/25 rounded-lg text-xs font-mono text-[#05E1FF]/90 overflow-x-auto leading-relaxed max-h-[55vh]">
          {KOTLIN_SNIPPETS[activeTab]}
        </pre>
      </div>
    </div>
  );
};

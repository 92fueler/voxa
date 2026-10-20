import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { checkBackend, DEFAULT_BACKEND_URL, HealthCheckError, type BackendHealth } from './src/backend';

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ready'; health: BackendHealth }
  | { status: 'error'; message: string };

export default function App() {
  return <SafeAreaProvider><VoxaShell /></SafeAreaProvider>;
}

function VoxaShell() {
  const [backendUrl, setBackendUrl] = useState(process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_BACKEND_URL);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<CheckState>({ status: 'idle' });
  const request = useRef<AbortController | null>(null);

  const reset = () => {
    request.current?.abort();
    request.current = null;
    setState({ status: 'idle' });
  };

  useEffect(() => {
    const listener = AppState.addEventListener('change', next => {
      if (next !== 'active') {
        request.current?.abort();
        request.current = null;
        setUsername('');
        setPassword('');
        setState({ status: 'idle' });
      }
    });
    return () => {
      request.current?.abort();
      listener.remove();
    };
  }, []);

  const runCheck = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ status: 'checking' });
    try {
      const health = await checkBackend(backendUrl, {
        credentials: { username, password },
        signal: controller.signal,
      });
      if (request.current === controller && !controller.signal.aborted) setState({ status: 'ready', health });
    } catch (error: unknown) {
      if (request.current === controller && !controller.signal.aborted) {
        setState({
          status: 'error',
          message: error instanceof HealthCheckError ? error.message : 'The check failed. Try again.',
        });
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  };

  const checking = state.status === 'checking';
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <View style={styles.topline}>
            <Text style={styles.wordmark}>Voxa</Text>
            <Text style={styles.badge}>iOS scaffold</Text>
          </View>
          <Text style={styles.eyebrow}>A LITTLE SPACE TO THINK</Text>
          <Text accessibilityRole="header" style={styles.title}>Good ideas start{'\n'}with a conversation.</Text>
          <Text style={styles.intro}>A native home for your voice companion. First, check the connection to your Voxa backend.</Text>

          <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.cardTitle}>Backend connection</Text>
            <Text style={styles.label}>Backend URL</Text>
            <TextInput
              accessibilityLabel="Backend URL"
              value={backendUrl}
              onChangeText={value => { reset(); setUsername(''); setPassword(''); setBackendUrl(value); }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              keyboardType="url"
              placeholder="https://your-backend.example"
              placeholderTextColor="#73756D"
              style={styles.input}
            />
            <Text style={styles.hint}>Use your deployed HTTPS origin. The default loopback URL works only in a simulator on the Mac running the backend, not on a physical iPhone.</Text>
            <Text style={styles.label}>Backend username (HTTPS only)</Text>
            <TextInput
              accessibilityLabel="Backend username"
              value={username}
              onChangeText={value => { reset(); setUsername(value); }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              textContentType="none"
              style={styles.input}
            />
            <Text style={styles.label}>Backend password (HTTPS only)</Text>
            <TextInput
              accessibilityLabel="Backend password"
              value={password}
              onChangeText={value => { reset(); setPassword(value); }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              textContentType="none"
              secureTextEntry
              style={styles.input}
            />
            <Text style={styles.hint}>Use only credentials for a backend you trust. Leave both empty for local development. Credentials stay in memory and clear when you leave the app or change the URL. Never enter an OpenAI key.</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={checking ? 'Checking backend' : 'Check backend'}
              accessibilityState={{ disabled: checking, busy: checking }}
              disabled={checking}
              onPress={() => { void runCheck(); }}
              style={({ pressed }) => [styles.button, (pressed || checking) && styles.buttonMuted]}
            >
              {checking && <ActivityIndicator color="#FFFFFF" />}
              <Text style={styles.buttonText}>{checking ? 'Checking…' : 'Check backend'}</Text>
            </Pressable>
            {(username || password) ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => { reset(); setUsername(''); setPassword(''); }}
                style={styles.clearButton}
              >
                <Text style={styles.clearText}>Clear credentials</Text>
              </Pressable>
            ) : null}
            <View accessibilityLiveRegion="polite" style={styles.result}>
              {state.status === 'idle' && <Text style={styles.hint}>No connection checked. This read-only check does not start a voice session or incur model usage.</Text>}
              {state.status === 'error' && <Text accessibilityRole="alert" style={styles.error}>{state.message}</Text>}
              {state.status === 'ready' && (
                <>
                  <Text style={styles.success}>Backend reachable</Text>
                  <Text style={styles.body}>{state.health.realtimeConfigured ? 'Voice provider key is configured on the server.' : 'The server still needs its voice provider key.'}</Text>
                  <Text style={styles.hint}>Model: {state.health.model}{'\n'}Session limit: {state.health.sessionMaxSeconds} seconds</Text>
                  <Text style={styles.hint}>Configuration is not proof of provider access or working audio.</Text>
                </>
              )}
            </View>
          </View>

          <View style={styles.boundary}>
            <Text accessibilityRole="header" style={styles.cardTitle}>Voice comes next</Text>
            <Text style={styles.body}>This shell does not yet record, play, or stream audio. WebRTC, microphone permission, archive access, Bluetooth routing, and locked-screen operation are not implemented.</Text>
            <Text style={styles.hint}>Continue using the web client for the existing voice experience.</Text>
          </View>
          <Text style={styles.footer}>Your permanent provider key belongs on the backend.{'\n'}No provider secret is bundled in this app.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: '#F7F5EF' },
  page: { padding: 24, gap: 18, maxWidth: 620, width: '100%', alignSelf: 'center' },
  topline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
  wordmark: { fontSize: 28, fontWeight: '700', color: '#23352A' },
  badge: { fontSize: 12, color: '#445C4C', backgroundColor: '#E4EBDF', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12 },
  eyebrow: { fontSize: 11, letterSpacing: 2, color: '#657161', fontWeight: '600' },
  title: { fontSize: 36, lineHeight: 42, letterSpacing: -1, color: '#22372A', fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  intro: { fontSize: 16, lineHeight: 24, color: '#576057', marginBottom: 8 },
  card: { backgroundColor: '#FFFFFF', borderColor: '#DDE3D7', borderWidth: 1, borderRadius: 20, padding: 20, gap: 12 },
  cardTitle: { fontSize: 20, fontWeight: '600', color: '#23352A', marginBottom: 2 },
  label: { fontSize: 14, fontWeight: '600', color: '#344B3B', marginTop: 4 },
  input: { borderColor: '#B5C0B0', borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 48, fontSize: 16, color: '#22372A', backgroundColor: '#FCFDFB' },
  hint: { fontSize: 13, lineHeight: 19, color: '#5D655B' },
  body: { fontSize: 15, lineHeight: 23, color: '#485646' },
  button: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#2E543E', borderRadius: 12, padding: 14, marginTop: 4 },
  buttonMuted: { opacity: 0.7 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  clearButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  clearText: { fontSize: 14, fontWeight: '600', color: '#345A41' },
  result: { gap: 8 },
  success: { fontSize: 16, color: '#276342', fontWeight: '600' },
  error: { fontSize: 14, lineHeight: 21, color: '#9C362A' },
  boundary: { padding: 20, gap: 12, borderRadius: 20, backgroundColor: '#ECEFE5' },
  footer: { fontSize: 12, lineHeight: 18, color: '#697163', textAlign: 'center', marginBottom: 16 },
});

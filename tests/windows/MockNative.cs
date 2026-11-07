using System;
using System.Collections.Generic;
public class PlayerAudio { public string name; public string process; public float volume; public bool muted; }
public static class MockState {
  public static List<string> Calls = new List<string>();
  public static List<PlayerAudio> Players = new List<PlayerAudio>();
  public static long Foreground = 100; public static uint ForegroundPid = 4242;
  public static bool ForegroundElevated = false; public static bool Self = false;
  public static void Log(string s) { Calls.Add(s); }
  public static string Dump() { return string.Join("|", Calls.ToArray()); }
}
public class WinAudio {
  public static IntPtr ForegroundHandle() { return new IntPtr(MockState.Foreground); }
  public static string WindowTitle(long h) { return h == MockState.Foreground ? "Notepad" : ""; }
  public static uint WindowProcessId(long h) { return h == MockState.Foreground ? MockState.ForegroundPid : 0; }
  public static bool ActivateWindow(long h) { MockState.Log("Activate " + h); return true; }
  public static bool WindowExists(long h) { return h == MockState.Foreground; }
  public static bool IsKeyLocked(int k) { return k == 0x14; }
  public static bool SetWindowState(long h, int s) { MockState.Log("State " + h + " " + s); return true; }
  public static bool CloseWindow(long h) { MockState.Log("Close " + h); return true; }
  public static void ReleaseRemoteModifiers() { MockState.Log("ReleaseMods"); }
  public static bool SendWindowKey(long h, byte key, bool ctrl = false, bool shift = false, bool alt = false) { MockState.Log("WinKey " + key); return true; }
  public static bool SendBrowserKey(long h, byte key, bool ctrl = false, bool shift = false, bool alt = false) { MockState.Log("BrowserKey " + key + (ctrl ? " ctrl" : "")); return true; }
  public static bool ActivatePlayer(string name) { MockState.Log("ActivatePlayer " + name); return true; }
  public static bool PostPlayerCommand(string name, int c) { MockState.Log("Post " + name + " " + c); return true; }
  public static bool IsProcessElevated(uint pid) { return MockState.ForegroundElevated && pid == MockState.ForegroundPid; }
  public static bool SelfElevated() { return MockState.Self; }
  public static bool Lock() { MockState.Log("Lock"); return true; }
  public static bool Sleep() { MockState.Log("Sleep"); return true; }
  public static void DisplayOff() { MockState.Log("DisplayOff"); }
  public static void Key(byte k) { MockState.Log("Key " + k); }
  public static void Tap(byte key, bool ctrl = false, bool shift = false, bool alt = false) { MockState.Log("Tap " + key + (ctrl ? " ctrl" : "") + (shift ? " shift" : "") + (alt ? " alt" : "")); }
}
public class AudioControl {
  public static float GetSystemVolume() { return 0.4f; }
  public static bool GetSystemMuted() { return false; }
  public static void SetSystemVolume(float v) { MockState.Log("SysVol " + Math.Round(v * 100)); }
  public static void ToggleSystemMute() { MockState.Log("SysMute"); }
  public static List<PlayerAudio> GetPlayers() { return new List<PlayerAudio>(MockState.Players); }
  public static bool SetPlayer(string name, float? volume, bool? mute) {
    var p = MockState.Players.Find(x => x.name == name); if (p == null) return false;
    if (volume.HasValue) { p.volume = volume.Value; MockState.Log("SetPlayerVol " + name + " " + Math.Round(volume.Value * 100)); }
    if (mute.HasValue) { p.muted = mute.Value; MockState.Log("SetPlayerMute " + name + " " + mute.Value); }
    return true;
  }
  public static List<string> Describe() { return new List<string> { "output 1: vlc 50%" }; }
}

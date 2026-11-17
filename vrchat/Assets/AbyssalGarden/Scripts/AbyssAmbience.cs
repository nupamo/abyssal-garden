// The web version's soundscape (source/src/audio.js), rebuilt from clips rendered by vrchat/exporter/audio.mjs:
// four loops (rumble, drone, surface wash, water rush) and one-shots picked at random like the original's timers
// (bubble bursts every 0.5-5 s, chimes every 2.5-9 s, whale phrases every 20-50 s).
// The wash gets louder near the surface; the rush follows how fast you swim. All 2D (it is everywhere).
using UdonSharp;
using UnityEngine;
using VRC.SDKBase;

[UdonBehaviourSyncMode(BehaviourSyncMode.None)]
public class AbyssAmbience : UdonSharpBehaviour
{
    [Header("Loops (play on awake, loop)")]
    public AudioSource wash;
    public AudioSource rush;
    public AudioSource[] alwaysOn; // rumble, drone
    [Header("One-shot voices and their clips")]
    public AudioSource[] voices;
    public AudioClip[] bubbleClips, chimeClips, whaleClips;
    public float volume = 0.78f;

    VRCPlayerApi player;
    float tB, tC, tW, tick, lastT;
    Vector3 last;
    int voice;
    bool muted;

    void Start()
    {
        player = Networking.LocalPlayer;
        float t = Time.time;
        tB = t + 1.5f; tC = t + 5f; tW = t + 12f; lastT = t;
        if (player != null) last = player.GetTrackingData(VRCPlayerApi.TrackingDataType.Head).position;
        SetVolume();
    }

    public void ToggleMute() { muted = !muted; SetVolume(); }

    void SetVolume()
    {
        float v = muted ? 0f : volume;
        foreach (var s in alwaysOn) if (s != null) s.volume = v;
        foreach (var s in voices) if (s != null) s.volume = v;
    }

    void Update()
    {
        float t = Time.time;
        if (t < tick || player == null || !player.IsValid()) return;
        tick = t + 0.1f; // 10 Hz, like the web version's timer
        float dt = t - lastT; lastT = t;
        Vector3 p = player.GetTrackingData(VRCPlayerApi.TrackingDataType.Head).position;
        float v = dt > 0f ? Vector3.Distance(p, last) / dt : 0f; if (v > 60f) v = 0f; // a teleport is not speed
        last = p;
        float master = muted ? 0f : volume;
        // the web version's rush is band-passed noise from 220 Hz up as you speed up: here, its loop pitched up
        if (rush != null)
        {
            rush.volume = Mathf.MoveTowards(rush.volume, master * 0.5f * Mathf.Pow(Mathf.Min(v / 26f, 1f), 1.2f), 0.05f);
            rush.pitch = Mathf.MoveTowards(rush.pitch, 0.75f + Mathf.Min(v / 26f, 1.5f) * 0.9f, 0.05f);
        }
        if (wash != null) { float s = Mathf.Clamp01(1f + p.y / 30f); wash.volume = Mathf.MoveTowards(wash.volume, master * (0.25f + 0.55f * s * s), 0.02f); }

        if (t > tB) { Play(bubbleClips); tB = t + Random.Range(0.5f, 5f) + 0.6f; }
        if (t > tC) { Play(chimeClips); tC = t + Random.Range(2.5f, 9f); }
        if (t > tW) { float len = Play(whaleClips); tW = t + len * 0.6f + Random.Range(20f, 50f); }
    }

    float Play(AudioClip[] clips)
    {
        if (clips == null || clips.Length == 0 || voices == null || voices.Length == 0) return 0f;
        var clip = clips[Random.Range(0, clips.Length)];
        var s = voices[voice]; voice = (voice + 1) % voices.Length;
        if (s == null || clip == null) return 0f;
        s.panStereo = Random.Range(-0.7f, 0.7f);
        s.PlayOneShot(clip);
        return clip.length;
    }
}

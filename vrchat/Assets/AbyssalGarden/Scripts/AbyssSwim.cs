// Swimming instead of walking, like the web version's free camera: no gravity, move where you look, smooth
// acceleration, faster on demand; the seabed and rocks still block you (their colliders). The world is a disc 150 m
// across from the centre, from the surface down to 52 m: the swimmer is eased back inside.
//
// Desktop: WASD + mouse, E / Space up, Q / C down, Shift faster, 1-6 jump to a viewpoint, M sound on/off.
// VR: left stick swims where you look, right stick up / down rises and sinks, hold the trigger to go faster.
using UdonSharp;
using UnityEngine;
using VRC.SDKBase;
using VRC.Udon.Common;

[UdonBehaviourSyncMode(BehaviourSyncMode.None)]
public class AbyssSwim : UdonSharpBehaviour
{
    public Transform[] viewpoints;
    public AbyssAmbience ambience;
    public float speed = 7f, fastSpeed = 26f, response = 4.5f;
    public float radius = 150f, surfaceY = -1.2f, bottomY = -52f;

    VRCPlayerApi player;
    float moveV, moveH, lookV;
    bool jump, use, inVR;
    Vector3 vel;

    void Start()
    {
        player = Networking.LocalPlayer;
        if (player == null) return;
        inVR = player.IsUserInVR();
        player.SetGravityStrength(0f);
        player.SetWalkSpeed(0f); player.SetRunSpeed(0f); player.SetStrafeSpeed(0f);
        player.SetJumpImpulse(0f);
    }

    public override void InputMoveVertical(float value, UdonInputEventArgs args) { moveV = value; }
    public override void InputMoveHorizontal(float value, UdonInputEventArgs args) { moveH = value; }
    public override void InputLookVertical(float value, UdonInputEventArgs args) { lookV = value; }
    public override void InputJump(bool value, UdonInputEventArgs args) { jump = value; }
    public override void InputUse(bool value, UdonInputEventArgs args) { use = value; }

    void Update()
    {
        if (player == null || !player.IsValid()) return;
        float dt = Mathf.Min(Time.deltaTime, 0.1f);
        var head = player.GetTrackingData(VRCPlayerApi.TrackingDataType.Head);
        Vector3 fwd = head.rotation * Vector3.forward;
        Vector3 right = Vector3.ProjectOnPlane(head.rotation * Vector3.right, Vector3.up).normalized; // horizontal, as in the web version

        float up = jump ? 1f : 0f;
        bool fast = use;
        if (inVR) up += Mathf.Abs(lookV) > 0.2f ? lookV : 0f;
        else
        {
            if (Input.GetKey(KeyCode.E)) up += 1f;
            if (Input.GetKey(KeyCode.Q) || Input.GetKey(KeyCode.C)) up -= 1f;
            fast = fast || Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift);
            for (int i = 0; i < viewpoints.Length && i < 6; i++)
                if (Input.GetKeyDown((KeyCode)((int)KeyCode.Alpha1 + i)) && viewpoints[i] != null) { player.TeleportTo(viewpoints[i].position, viewpoints[i].rotation); vel = Vector3.zero; }
            if (Input.GetKeyDown(KeyCode.M) && ambience != null) ambience.ToggleMute();
        }
        up = Mathf.Clamp(up, -1f, 1f);

        float sp = fast ? fastSpeed : speed;
        Vector3 target = (fwd * moveV + right * moveH + Vector3.up * up) * sp;
        vel += (target - vel) * (1f - Mathf.Exp(-dt * response));

        // ease back inside the world: below the surface, above the floor of the grid, within the disc
        Vector3 h = head.position;
        if (h.y > surfaceY) vel.y = Mathf.Min(vel.y, (surfaceY - h.y) * 4f);
        if (h.y < bottomY) vel.y = Mathf.Max(vel.y, (bottomY - h.y) * 4f);
        Vector2 xz = new Vector2(h.x, h.z);
        float r = xz.magnitude;
        if (r > radius)
        {
            Vector3 n = new Vector3(xz.x / r, 0f, xz.y / r);
            float out_ = Vector3.Dot(vel, n), want = (radius - r) * 4f;
            if (out_ > want) vel += n * (want - out_);
        }
        player.SetVelocity(vel);
    }
}

// Abyssal Garden > Import World: turns the exporter's raw data (Assets/AbyssalGarden/Raw~, written by
// vrchat/exporter/export.mjs) into textures, meshes and materials under Assets/AbyssalGarden/Generated, and builds the
// "Abyssal Garden" hierarchy in the open scene (replacing an earlier one).
//
// Rendering model (see the README): every instanced thing is a template mesh (K copies of a blade, rock, quad...) whose
// vertices know their slot; a MaterialPropertyBlock gives each renderer its first instance (_Base) and count (_Count),
// and the shader reads the instance from a float texture. AbyssInstanceTable sets those blocks at runtime (VRChat keeps
// no MonoBehaviours); this importer sets them too, so the scene view shows the world right away.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UdonSharp;
using UdonSharpEditor;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

namespace AbyssalGarden.EditorTools
{
    public static class AbyssImporter
    {
        const string Root = "Assets/AbyssalGarden";
        const string Gen = Root + "/Generated";
        static string Raw => Path.Combine(Application.dataPath, "AbyssalGarden", "Raw~");

        // ------------------------------------------------------------ manifest (see export.mjs)
        [Serializable] class Manifest { public string level; public WorldInfo world; public TexInfo[] textures; public TemplateInfo[] templates; public SetInfo[] sets; public Viewpoint[] viewpoints; public string surfaceMesh, sphereMesh, floorMesh; public int waterSize; }
        [Serializable] class WorldInfo { public float OX, OY, OZ, VS, cellSize; public int NX, NY, NZ, cells; }
        [Serializable] class TexInfo { public string name, file, format; public int width, height, depth, texelsPerInstance, instances; }
        [Serializable] class TemplateInfo { public string name, file; public int vertices, indices; }
        [Serializable] class SetInfo { public string name, shader, texture, template; public int K, rows, mesh; public bool celled; public float minD, maxD, far; public TexParam[] textures; public FloatParam[] floats; public Draw[] draws; }
        [Serializable] class TexParam { public string name, value; }
        [Serializable] class FloatParam { public string name; public float value; }
        [Serializable] class Draw { public int cell, @base, count; public float cx, cz; }
        [Serializable] class Viewpoint { public float[] position, lookAt; }

        // the LODGroups cull a cell once it is surely past its set's draw band (the shaders cut each instance at the
        // band's exact end). Assumed field of view: wider than headsets' (a narrower one only culls later).
        const float AssumedFov = 120f;

        [MenuItem("Abyssal Garden/Import World", priority = 1)]
        public static void Import()
        {
            var mf = Path.Combine(Raw, "manifest.json");
            if (!File.Exists(mf)) { EditorUtility.DisplayDialog("Abyssal Garden", "No exported world found in\n" + Raw + "\n\nRun vrchat/exporter/export.mjs first (see the README).", "OK"); return; }
            var man = JsonUtility.FromJson<Manifest>(File.ReadAllText(mf));
            try
            {
                if (!AssetDatabase.IsValidFolder(Gen)) AssetDatabase.CreateFolder(Root, "Generated");
                Fresh(Gen + "/Materials");
                Build(man);
            }
            finally { EditorUtility.ClearProgressBar(); }
            AssetDatabase.SaveAssets();
            EnsureProgramAssets();
            Debug.Log("[Abyssal Garden] Imported the " + man.level + " world (see vrchat/README.md for the next steps).");
        }

        static void Progress(string what, float f) => EditorUtility.DisplayProgressBar("Abyssal Garden", what, f);

        static void Build(Manifest man)
        {
            // ---------------------------------------------------------------- textures
            Progress("Textures", 0.05f);
            var tex = new Dictionary<string, Texture>();
            foreach (var t in man.textures)
            {
                var bytes = File.ReadAllBytes(Path.Combine(Raw, t.file));
                Texture made;
                if (t.depth > 1)
                {
                    // volume (RG8), terrain SDF near (R8, linear) and far (R8, read with Load)
                    var v = new Texture3D(t.width, t.height, t.depth, t.format == "RG16" ? TextureFormat.RG16 : TextureFormat.R8, false)
                        { wrapMode = TextureWrapMode.Clamp, filterMode = t.name == "sdfFar" ? FilterMode.Point : FilterMode.Bilinear, name = "Abyss " + t.name };
                    v.SetPixelData(bytes, 0);
                    v.Apply(false);
                    made = v;
                }
                else
                {
                    var fmt = t.format == "RGBA32" ? TextureFormat.RGBA32 : t.format == "R16" ? TextureFormat.R16 : t.format == "RGBAHalf" ? TextureFormat.RGBAHalf : TextureFormat.RGBAFloat;
                    bool mips = false;
                    var t2 = new Texture2D(t.width, t.height, fmt, mips, true) { name = "Abyss " + t.name };
                    t2.SetPixelData(bytes, 0); // mip 0; Apply makes the rest
                    t2.Apply(mips);
                    t2.wrapMode = t.name == "detail" ? TextureWrapMode.Repeat : TextureWrapMode.Clamp;
                    t2.filterMode = t.name == "detail" ? FilterMode.Trilinear : t.name == "ground" ? FilterMode.Bilinear : FilterMode.Point;
                    if (mips) t2.anisoLevel = 8;
                    made = t2;
                }
                tex[t.name] = SaveAsset(made, Gen + "/Tex_" + t.name + ".asset");
            }

            // the animated water texture: a CustomRenderTexture that runs AbyssWater.shader every frame
            var waterMat = SaveAsset(new Material(FindShader("Abyssal Garden/Water (Custom Render Texture)")), Gen + "/Materials/Water CRT.mat");
            var crt = new CustomRenderTexture(man.waterSize, man.waterSize, RenderTextureFormat.ARGBHalf, RenderTextureReadWrite.Linear)
            {
                name = "Abyss Water", material = waterMat, updateMode = CustomRenderTextureUpdateMode.Realtime, initializationMode = CustomRenderTextureUpdateMode.OnLoad,
                useMipMap = true, autoGenerateMips = true, wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Trilinear, anisoLevel = 4, doubleBuffered = false,
            };
            var water = SaveAsset(crt, Gen + "/Water.asset");
            // the rock detail texture: made once on load by AbyssDetail.shader (nothing stored)
            var detailMat = SaveAsset(new Material(FindShader("Abyssal Garden/Detail (Custom Render Texture)")), Gen + "/Materials/Detail CRT.mat");
            tex["detail"] = SaveAsset(new CustomRenderTexture(1024, 1024, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Linear)
            {
                name = "Abyss Detail", material = detailMat, updateMode = CustomRenderTextureUpdateMode.OnLoad, initializationMode = CustomRenderTextureUpdateMode.OnLoad,
                useMipMap = true, autoGenerateMips = true, wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Trilinear, anisoLevel = 8, doubleBuffered = false,
            }, Gen + "/Detail.asset");

            Material Mat(string shader, string name, string inst = null)
            {
                var m = new Material(FindShader(shader)) { name = name };
                foreach (var p in new[] { ("_AbyssWater", (Texture)water), ("_AbyssDetail", tex["detail"]), ("_AbyssVolume", tex["volume"]), ("_AbyssGround", tex["ground"]), ("_AbyssShadow", tex["shadow"]), ("_AbyssSDF", tex["sdf"]), ("_AbyssSDFFar", tex["sdfFar"]) })
                    if (m.HasProperty(p.Item1)) m.SetTexture(p.Item1, p.Item2);
                if (inst != null) m.SetTexture("_AbyssInst", tex[inst]);
                return m;
            }

            // ---------------------------------------------------------------- meshes
            Progress("Meshes", 0.3f);
            Fresh(Gen + "/Meshes");
            var templates = man.templates.ToDictionary(t => t.name);
            var meshes = new Dictionary<string, Mesh>();
            // cell sets get a mesh with the bounds of one cell (the renderer sits at the cell's centre), whole-world sets
            // one with bounds around the whole world
            Mesh Template(string name, bool celled)
            {
                var key = name + (celled ? "" : " (world)");
                if (meshes.TryGetValue(key, out var m)) return m;
                m = ReadTemplate(Path.Combine(Raw, templates[name].file), key);
                float half = man.world.cellSize * 0.5f + 6f;
                m.bounds = celled ? new Bounds(new Vector3(0, -27.5f, 0), new Vector3(half * 2, 63f, half * 2)) : new Bounds(Vector3.zero, Vector3.one * 4000f);
                return meshes[key] = SaveAsset(m, Gen + "/Meshes/" + key + ".asset");
            }

            // ---------------------------------------------------------------- scene
            Progress("Scene", 0.5f);
            var old = GameObject.Find("Abyssal Garden");
            if (old) UnityEngine.Object.DestroyImmediate(old);
            var root = new GameObject("Abyssal Garden");
            var renderers = new List<Renderer>();
            var bases = new List<float>();
            var counts = new List<float>();

            // terrain: raymarched (a sphere wrapped around the camera), and a floor heightfield to keep the player above
            // the sea floor (rocks are passable)
            var sphere = Template(man.sphereMesh, false);
            Single(root, "Terrain (raymarched)", sphere, SaveAsset(Mat("Abyssal Garden/Raymarch Terrain", "Raymarch Terrain"), Gen + "/Materials/Raymarch Terrain.mat"));
            Child(root, "Floor Collider").AddComponent<MeshCollider>().sharedMesh = Template(man.floorMesh, false);

            // instanced sets
            var setsGo = Child(root, "Instanced");
            int si = 0;
            foreach (var s in man.sets)
            {
                Progress("Scene: " + s.name, 0.5f + 0.45f * si++ / man.sets.Length);
                string shader = s.shader switch
                {
                    "leaf" => "Abyssal Garden/Leaf", "solid" => "Abyssal Garden/Solid", "glint" => "Abyssal Garden/Glint",
                    "bubble" => "Abyssal Garden/Sprites", "snow" => "Abyssal Garden/Sprites", "fish" => "Abyssal Garden/Fish", "manta" => "Abyssal Garden/Manta",
                    _ => throw new Exception("unknown shader kind " + s.shader),
                };
                var mat = Mat(shader, s.name, string.IsNullOrEmpty(s.texture) ? null : s.texture);
                if (mat.HasProperty("_MinD")) { mat.SetFloat("_MinD", s.minD); mat.SetFloat("_MaxD", s.maxD); }
                if (s.textures != null) foreach (var p in s.textures) mat.SetTexture(p.name, tex[p.value]);
                if (s.floats != null) foreach (var p in s.floats) mat.SetFloat(p.name, p.value);
                if (s.shader == "leaf") mat.SetFloat("_Far", s.far);
                if (s.shader == "bubble") { mat.SetFloat("_Mode", 0); mat.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha); }
                if (s.shader == "snow") { mat.SetFloat("_Mode", 1); mat.SetFloat("_DstBlend", (float)BlendMode.One); }
                mat = SaveAsset(mat, Gen + "/Materials/" + s.name + ".mat");
                var mesh = Template(s.template, s.celled);
                var group = Child(setsGo, s.name);
                // farthest the cell's reference point (centre, 27.5 m down) can be while part of the cell, plus blades
                // reaching 4 m out of it, is within the band: half the cell diagonal across, 35 m up or down.
                // LODGroup.size is 1, so the relative screen height there is 0.5 / (distance * tan(fov / 2))
                float reach = Mathf.Sqrt(Mathf.Pow(s.maxD + man.world.cellSize * 0.7072f + 4f, 2f) + 35f * 35f);
                float cullH = 0.5f / (reach * Mathf.Tan(AssumedFov * 0.5f * Mathf.Deg2Rad));
                for (int d = 0; d < s.draws.Length; d++)
                {
                    var dr = s.draws[d];
                    var go = Child(group, s.celled ? $"Cell {dr.cell} #{d}" : $"Draw {d}");
                    if (s.celled) go.transform.localPosition = new Vector3(dr.cx, 0, -dr.cz);
                    go.AddComponent<MeshFilter>().sharedMesh = mesh;
                    var r = go.AddComponent<MeshRenderer>();
                    Quiet(r, mat);
                    if (s.celled && s.maxD < 1000)
                    {
                        var lg = go.AddComponent<LODGroup>();
                        lg.localReferencePoint = new Vector3(0, -27.5f, 0);
                        lg.size = 1f;
                        lg.SetLODs(new[] { new LOD(cullH, new Renderer[] { r }) });
                        lg.fadeMode = LODFadeMode.None;
                    }
                    renderers.Add(r); bases.Add(dr.@base); counts.Add(dr.count);
                }
            }

            // camera-following objects
            Single(root, "Light Shafts", sphere, SaveAsset(Mat("Abyssal Garden/Light Shafts", "Light Shafts"), Gen + "/Materials/Light Shafts.mat"));
            Single(root, "Post (grade + tonemap)", sphere, SaveAsset(Mat("Abyssal Garden/Post", "Post"), Gen + "/Materials/Post.mat"));

            // viewpoints 1-6 (the first is the spawn): feet 1.2 m below the web version's eye point
            var vpRoot = Child(root, "Viewpoints");
            var vps = new List<Transform>();
            for (int i = 0; i < man.viewpoints.Length; i++)
            {
                var v = man.viewpoints[i];
                var p = new Vector3(v.position[0], v.position[1] - 1.2f, v.position[2]);
                var look = new Vector3(v.lookAt[0] - p.x, 0, v.lookAt[2] - p.z);
                var go = Child(vpRoot, "Viewpoint " + (i + 1));
                go.transform.SetPositionAndRotation(p, Quaternion.LookRotation(look.sqrMagnitude > 0 ? look : Vector3.forward));
                vps.Add(go.transform);
            }

            // reference camera: VRChat copies its settings to the player's camera (HDR for the post pass, far plane past
            // the 900 m water surface)
            var camGo = Child(root, "Reference Camera");
            var cam = camGo.AddComponent<Camera>();
            cam.allowHDR = true; cam.allowMSAA = true; cam.nearClipPlane = 0.05f; cam.farClipPlane = 1500f;
            cam.clearFlags = CameraClearFlags.SolidColor; cam.backgroundColor = Color.black;
            cam.enabled = false;
            camGo.transform.SetPositionAndRotation(vps[0].position + Vector3.up * 1.3f, vps[0].rotation);

            // the light shafts need the camera depth texture; a directional light with shadows makes Unity render it. It
            // lights nothing: our shaders do their own lighting and its culling mask holds only the (empty) Water layer
            var lightGo = Child(root, "Depth Light (for the light shafts)");
            var light = lightGo.AddComponent<Light>();
            light.type = LightType.Directional; light.shadows = LightShadows.Hard; light.intensity = 0.001f; light.shadowStrength = 0f;
            light.cullingMask = 1 << 4; light.renderMode = LightRenderMode.ForcePixel;
            lightGo.transform.rotation = Quaternion.LookRotation(new Vector3(-0.25f, -0.94f, -0.23f));

            // ---------------------------------------------------------------- runtime scripts
            var table = AddUdon<AbyssInstanceTable>(root);
            if (table)
            {
                table.renderers = renderers.ToArray(); table.bases = bases.ToArray(); table.counts = counts.ToArray();
                EditorUtility.SetDirty(table);
            }
            var ambience = BuildAmbience(root);
            var swimGo = Child(root, "Swimming");
            var swim = AddUdon<AbyssSwim>(swimGo);
            if (swim) { swim.viewpoints = vps.ToArray(); swim.ambience = ambience; EditorUtility.SetDirty(swim); }

            // spawn + reference camera on the scene descriptor, if there is one
            var desc = UnityEngine.Object.FindObjectOfType<VRC.SDKBase.VRC_SceneDescriptor>();
            if (desc)
            {
                desc.spawns = new[] { vps[0] };
                desc.ReferenceCamera = camGo;
                desc.RespawnHeightY = -200f;
                EditorUtility.SetDirty(desc);
            }
            else Debug.LogWarning("[Abyssal Garden] No VRCWorld in the scene: add one (VRChat SDK > Utilities, or the VRCWorld prefab), then import again so it gets the spawn and the reference camera.");

            ApplyBlocks(renderers, bases, counts);
            EditorSceneManager.MarkSceneDirty(root.scene);
            Selection.activeGameObject = root;
        }

        // ------------------------------------------------------------ helpers
        static Shader FindShader(string name) => Shader.Find(name) ?? throw new Exception("Shader not found: " + name + " (did the shaders compile? see the Console)");

        static T SaveAsset<T>(T obj, string path) where T : UnityEngine.Object
        {
            AssetDatabase.DeleteAsset(path);
            AssetDatabase.CreateAsset(obj, path);
            return obj;
        }

        // an empty folder (what an earlier import left there goes)
        static void Fresh(string folder)
        {
            AssetDatabase.DeleteAsset(folder);
            AssetDatabase.CreateFolder(Path.GetDirectoryName(folder).Replace('\\', '/'), Path.GetFileName(folder));
        }

        static GameObject Child(GameObject parent, string name)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent.transform, false);
            return go;
        }

        // our shaders light themselves: no Unity shadows, probes or motion vectors
        static void Quiet(MeshRenderer r, Material m)
        {
            r.sharedMaterial = m;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = LightProbeUsage.Off;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            r.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
            r.allowOcclusionWhenDynamic = false;
        }

        static void Single(GameObject root, string name, Mesh mesh, Material mat)
        {
            var go = Child(root, name);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            Quiet(go.AddComponent<MeshRenderer>(), mat);
        }

        static List<Vector3> ReadVec3(BinaryReader br, int n)
        {
            var l = new List<Vector3>(n);
            for (int i = 0; i < n; i++) l.Add(new Vector3(br.ReadSingle(), br.ReadSingle(), br.ReadSingle()));
            return l;
        }
        static int[] ReadInts(BinaryReader br, int n)
        {
            var a = new int[n];
            for (int i = 0; i < n; i++) a[i] = br.ReadInt32();
            return a;
        }

        // template layout: u32 nv, u32 ni, f32x3 pos[nv], f32x3 normal[nv], f32x4 uv[nv], u32 index[ni]
        static Mesh ReadTemplate(string file, string name)
        {
            using var br = new BinaryReader(File.OpenRead(file));
            int nv = br.ReadInt32(), ni = br.ReadInt32();
            var pos = ReadVec3(br, nv); var nrm = ReadVec3(br, nv);
            var uv = new List<Vector4>(nv);
            for (int i = 0; i < nv; i++) uv.Add(new Vector4(br.ReadSingle(), br.ReadSingle(), br.ReadSingle(), br.ReadSingle()));
            var idx = ReadInts(br, ni);
            var m = new Mesh { name = name, indexFormat = nv > 65535 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            m.SetVertices(pos); m.SetNormals(nrm); m.SetUVs(0, uv);
            m.SetIndices(idx, MeshTopology.Triangles, 0, false);
            m.UploadMeshData(false);
            return m;
        }

        // the soundscape: clips rendered by vrchat/exporter/audio.mjs (committed in Assets/AbyssalGarden/Audio)
        static AbyssAmbience BuildAmbience(GameObject root)
        {
            AudioClip Clip(string n) => AssetDatabase.LoadAssetAtPath<AudioClip>(Root + "/Audio/" + n + ".ogg");
            AudioClip[] Clips(string prefix) => Enumerable.Range(0, 20).Select(i => Clip(prefix + i)).Where(c => c).ToArray();
            var go = Child(root, "Ambience");
            AudioSource Source(string name, AudioClip clip, bool loop)
            {
                var s = Child(go, name).AddComponent<AudioSource>();
                s.clip = clip; s.loop = loop; s.playOnAwake = loop; s.spatialBlend = 0f; s.dopplerLevel = 0f; s.volume = 0f; s.priority = loop ? 32 : 64;
                return s;
            }
            var amb = AddUdon<AbyssAmbience>(go);
            var rumble = Source("Rumble", Clip("loop_rumble"), true);
            var drone = Source("Drone", Clip("loop_drone"), true);
            var wash = Source("Surface Wash", Clip("loop_wash"), true);
            var rush = Source("Water Rush", Clip("loop_rush"), true);
            var voices = Enumerable.Range(0, 8).Select(i => Source("Voice " + (i + 1), null, false)).ToArray();
            if (amb)
            {
                amb.alwaysOn = new[] { rumble, drone }; amb.wash = wash; amb.rush = rush; amb.voices = voices;
                amb.bubbleClips = Clips("bubbles_"); amb.chimeClips = Clips("chime_"); amb.whaleClips = Clips("whale_");
                EditorUtility.SetDirty(amb);
            }
            return amb;
        }

        static T AddUdon<T>(GameObject go) where T : UdonSharpBehaviour
        {
            try { return UdonSharpUndo.AddComponent<T>(go); }
            catch (Exception e)
            {
                Debug.LogWarning($"[Abyssal Garden] Could not add {typeof(T).Name} ({e.Message}). Add it to \"{go.name}\" by hand and import again.");
                return null;
            }
        }

        // UdonSharp needs a program asset next to each script
        static void EnsureProgramAssets()
        {
            bool made = false;
            foreach (var name in new[] { "AbyssInstanceTable", "AbyssSwim", "AbyssAmbience" })
            {
                var cs = Root + "/Scripts/" + name + ".cs";
                var asset = Root + "/Scripts/" + name + ".asset";
                if (AssetDatabase.LoadAssetAtPath<UdonSharpProgramAsset>(asset)) continue;
                var p = ScriptableObject.CreateInstance<UdonSharpProgramAsset>();
                p.sourceCsScript = AssetDatabase.LoadAssetAtPath<MonoScript>(cs);
                AssetDatabase.CreateAsset(p, asset);
                made = true;
            }
            if (made) { AssetDatabase.SaveAssets(); Debug.Log("[Abyssal Garden] Created the UdonSharp program assets. If a script shows as missing, run Import World once more."); }
        }

        // ------------------------------------------------------------ editor preview
        static void ApplyBlocks(List<Renderer> rs, List<float> bases, List<float> counts)
        {
            var b = new MaterialPropertyBlock();
            for (int i = 0; i < rs.Count; i++)
            {
                b.Clear();
                b.SetFloat("_Base", bases[i]);
                b.SetFloat("_Count", counts[i]);
                rs[i].SetPropertyBlock(b);
            }
        }

        // the property blocks are not saved with the scene: after reopening it, this brings the preview back
        [MenuItem("Abyssal Garden/Refresh Scene View Preview", priority = 2)]
        public static void RefreshPreview()
        {
            var table = UnityEngine.Object.FindObjectOfType<AbyssInstanceTable>();
            if (!table || table.renderers == null) { Debug.LogWarning("[Abyssal Garden] No AbyssInstanceTable in the scene: run Import World."); return; }
            ApplyBlocks(table.renderers.ToList(), table.bases.ToList(), table.counts.ToList());
            SceneView.RepaintAll();
        }
    }
}

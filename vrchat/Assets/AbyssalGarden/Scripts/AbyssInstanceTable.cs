// Gives every instanced renderer its slice of the instance data: _Base (first instance) and _Count. The importer
// fills the arrays; property blocks are not saved with a scene, so they are set again when the world loads.
using UdonSharp;
using UnityEngine;

[UdonBehaviourSyncMode(BehaviourSyncMode.None)]
public class AbyssInstanceTable : UdonSharpBehaviour
{
    public Renderer[] renderers;
    public float[] bases;
    public float[] counts;

    void Start()
    {
        var block = new MaterialPropertyBlock();
        for (int i = 0; i < renderers.Length; i++)
        {
            if (renderers[i] == null) continue;
            block.Clear();
            block.SetFloat("_Base", bases[i]);
            block.SetFloat("_Count", counts[i]);
            renderers[i].SetPropertyBlock(block);
        }
    }
}

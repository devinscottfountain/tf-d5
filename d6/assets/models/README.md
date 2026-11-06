# Hero models

`cyber-shroud.glb`: TerraFirma PN342 ATLAS Cyber Shroud (Onshape OBJ export, 9.1 MB, 131,740 tris)
reduced with gltfpack 0.21.0: `gltfpack -i shroud.obj -o cyber-shroud.glb -si 0.1 -cc`
(meshopt compressed, quantized, 7 primitives / 7 materials, 19,165 tris, 122 KB).
Units are metres; bounds 1.388 x 0.773 x 0.294. Load with GLTFLoader + MeshoptDecoder
(`three/addons/libs/meshopt_decoder.module.js`) and recompute normals with
`BufferGeometryUtils.toCreasedNormals(geo, Math.PI / 6)`; the simplified normals shade badly.

import React, {
  useEffect,
  useRef,
  useState,
  Suspense,
  useCallback,
} from "react";
import { Canvas, useLoader, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, TransformControls } from "@react-three/drei";
import { OBJLoader } from "three-stdlib";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  serverTimestamp,
  doc,
  getDoc,
} from "firebase/firestore";
import Swal from "sweetalert2";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FaTrash } from "react-icons/fa";
import * as THREE from "three";

import { auth, db } from "../firebase";
import "../styles/Design3D.css";

/* =========================
   MODEL LOADERS
========================= */

const ObjModel = ({ path }) => {
  const obj = useLoader(OBJLoader, path);

  useEffect(() => {
    obj.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }, [obj]);

  return <primitive object={obj} />;
};

const GlbModel = ({ path }) => {
  const gltf = useLoader(GLTFLoader, path);

  useEffect(() => {
    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }, [gltf]);

  return <primitive object={gltf.scene} />;
};

/* =========================
   MODEL WRAPPER
========================= */

const ModelMesh = ({
  model,
  selected,
  onSelect,
  registerRef,
  rememberTransform,
  applyConstraintsAndSync,
}) => {
  const ref = useRef();

  useEffect(() => {
    if (ref.current) {
      ref.current.position.set(...(model.position || [0, 0, 0]));
      ref.current.rotation.set(...(model.rotation || [0, 0, 0]));
      ref.current.scale.set(...(model.scale || [1, 1, 1]));
      registerRef(model.id, ref.current);
    }

    return () => {
      registerRef(model.id, null);
    };
  }, [model, registerRef]);

  return (
    <>
      <group
        ref={ref}
        position={model.position || [0, 0, 0]}
        rotation={model.rotation || [0, 0, 0]}
        scale={model.scale || [1, 1, 1]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(model.id);
        }}
      >
        {model.fileType === "obj" ? (
          <ObjModel path={model.path} />
        ) : (
          <GlbModel path={model.path} />
        )}
      </group>

      {selected && ref.current && (
        <TransformControls
          object={ref.current}
          mode="translate"
          onMouseDown={() => rememberTransform(model.id, ref.current)}
          onObjectChange={() => applyConstraintsAndSync(model.id, ref.current)}
        />
      )}
    </>
  );
};

/* =========================
   ROOM STRUCTURE
========================= */

const WallsAndFloor = ({
  roomWidth,
  roomLength,
  roomHeight,
  wallColor,
  floorColor,
}) => {
  const { camera } = useThree();
  const [hideWall, setHideWall] = useState("");

  useFrame(() => {
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);

    if (Math.abs(camDir.x) > Math.abs(camDir.z)) {
      setHideWall(camDir.x > 0 ? "left" : "right");
    } else {
      setHideWall(camDir.z > 0 ? "back" : "front");
    }
  });

  return (
    <group>
      {hideWall !== "back" && (
        <mesh position={[0, roomHeight / 2, -roomLength / 2]} receiveShadow>
          <planeGeometry args={[roomWidth, roomHeight]} />
          <meshStandardMaterial color={wallColor} side={THREE.DoubleSide} />
        </mesh>
      )}

      {hideWall !== "front" && (
        <mesh
          position={[0, roomHeight / 2, roomLength / 2]}
          rotation={[0, Math.PI, 0]}
          receiveShadow
        >
          <planeGeometry args={[roomWidth, roomHeight]} />
          <meshStandardMaterial color={wallColor} side={THREE.DoubleSide} />
        </mesh>
      )}

      {hideWall !== "left" && (
        <mesh
          position={[-roomWidth / 2, roomHeight / 2, 0]}
          rotation={[0, Math.PI / 2, 0]}
          receiveShadow
        >
          <planeGeometry args={[roomLength, roomHeight]} />
          <meshStandardMaterial color={wallColor} side={THREE.DoubleSide} />
        </mesh>
      )}

      {hideWall !== "right" && (
        <mesh
          position={[roomWidth / 2, roomHeight / 2, 0]}
          rotation={[0, -Math.PI / 2, 0]}
          receiveShadow
        >
          <planeGeometry args={[roomLength, roomHeight]} />
          <meshStandardMaterial color={wallColor} side={THREE.DoubleSide} />
        </mesh>
      )}

      <mesh
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[roomWidth, roomLength]} />
        <meshStandardMaterial color={floorColor} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
};

/* =========================
   MAIN COMPONENT
========================= */

const Design3D = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const designId = searchParams.get("designId");

  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingConverted, setLoadingConverted] = useState(false);

  const [designName, setDesignName] = useState("My 3D Design");
  const [models, setModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState(null);

  const [roomWidth, setRoomWidth] = useState(8);
  const [roomLength, setRoomLength] = useState(8);
  const [roomHeight, setRoomHeight] = useState(3);

  const [wallColor, setWallColor] = useState("#f5f5f5");
  const [floorColor, setFloorColor] = useState("#e0cda9");

  const [shade, setShade] = useState(100);
  const [modelType, setModelType] = useState("Chair1");
  const [isPublic, setIsPublic] = useState(false);
  const [collisionMessage, setCollisionMessage] = useState("");

  const modelRefs = useRef({});
  const previousTransforms = useRef({});

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
        navigate("/login");
      } else {
        setUser(currentUser);
      }
      setCheckingAuth(false);
    });

    return () => unsub();
  }, [navigate]);

  /* =========================
     REAL MODEL PATHS
  ========================= */

  const modelPaths = {
    Bookrack: "/models/Bookrack.glb",
    Chair1: "/models/Chair1.glb",
    Chair2: "/models/Chair2.glb",
    Coffeetable: "/models/coffeetable.glb",
    Rack2: "/models/rack2.glb",
    Couch: "/models/couch02.glb",
    Sofa: "/models/sofa1.glb",
    Sofa2: "/models/soffaaaa.glb",
  };

  /* =========================
     2D -> 3D MAPPING
  ========================= */

  const mapFurnitureType = useCallback((type) => {
    const safeType = (type || "").toLowerCase();

    if (safeType.includes("bed1") || safeType.includes("bed2") || safeType.includes("bed")) {
      return "Sofa2";
    }

    if (safeType.includes("chair1")) {
      return "Chair1";
    }

    if (safeType.includes("chair2")) {
      return "Chair2";
    }

    if (safeType.includes("chair")) {
      return "Chair1";
    }

    if (safeType.includes("table1") || safeType.includes("table")) {
      return "Coffeetable";
    }

    if (safeType.includes("sofa1")) {
      return "Sofa";
    }

    if (safeType.includes("sofa2")) {
      return "Sofa2";
    }

    if (safeType.includes("sofa")) {
      return "Sofa";
    }

    if (safeType.includes("couch")) {
      return "Couch";
    }

    if (safeType.includes("rack")) {
      return "Rack2";
    }

    if (safeType.includes("book")) {
      return "Bookrack";
    }

    if (safeType.includes("gaming")) {
      return "GamingChair";
    }

    return "Chair1";
  }, []);

  const getDefaultScaleByModel = useCallback((mappedModel, obj) => {
    const w = obj?.width || 80;
    const h = obj?.height || 80;

    if (mappedModel === "Chair1" || mappedModel === "Chair2") {
      return [Math.max(0.35, w / 180), Math.max(0.35, h / 180), Math.max(0.35, w / 180)];
    }

    if (mappedModel === "Coffeetable") {
      return [Math.max(0.45, w / 150), Math.max(0.45, h / 150), Math.max(0.45, w / 150)];
    }

    if (mappedModel === "Sofa" || mappedModel === "Sofa2" || mappedModel === "Couch") {
      return [Math.max(0.5, w / 160), Math.max(0.5, h / 160), Math.max(0.5, w / 160)];
    }

    if (mappedModel === "Rack2" || mappedModel === "Bookrack") {
      return [Math.max(0.45, w / 170), Math.max(0.45, h / 140), Math.max(0.45, w / 170)];
    }

    if (mappedModel === "GamingChair") {
      return [Math.max(0.45, w / 170), Math.max(0.45, h / 170), Math.max(0.45, w / 170)];
    }

    return [0.5, 0.5, 0.5];
  }, []);

  const convert2Dto3D = useCallback(
    (designData) => {
      if (!designData || !Array.isArray(designData.objects)) return [];

      const scaleFactor = 0.05;

      return designData.objects.map((obj, index) => {
        const mappedModel = mapFurnitureType(obj.type || obj.label || "");
        const path = modelPaths[mappedModel] || modelPaths.Chair1;
        const fileType = path.endsWith(".obj") ? "obj" : "glb";

        return {
          id: Date.now() + index + Math.random(),
          name: mappedModel,
          source2DType: obj.type || obj.label || "",
          path,
          fileType,
          position: [
            (obj.x || 0) * scaleFactor,
            0,
            (obj.y || 0) * scaleFactor,
          ],
          rotation: [0, ((obj.rotation || 0) * Math.PI) / 180, 0],
          scale: getDefaultScaleByModel(mappedModel, obj),
        };
      });
    },
    [mapFurnitureType, getDefaultScaleByModel]
  );

  /* =========================
     LOAD FROM localStorage
  ========================= */

  useEffect(() => {
    const localConverted = localStorage.getItem("converted3DDesign");
    if (!localConverted) return;

    try {
      setLoadingConverted(true);

      const parsed = JSON.parse(localConverted);

      if (parsed?.designName) setDesignName(parsed.designName);
      if (parsed?.roomWidth) setRoomWidth(Number(parsed.roomWidth) || 8);
      if (parsed?.roomLength) setRoomLength(Number(parsed.roomLength) || 8);
      if (parsed?.roomHeight) setRoomHeight(Number(parsed.roomHeight) || 3);
      if (Array.isArray(parsed?.models)) setModels(parsed.models);

      localStorage.removeItem("converted3DDesign");
    } catch (error) {
      console.error("Failed to read converted3DDesign from localStorage:", error);
    } finally {
      setLoadingConverted(false);
    }
  }, []);

  /* =========================
     LOAD FROM FIRESTORE 2D DESIGN
  ========================= */

  useEffect(() => {
    const load2DDesignAndConvert = async () => {
      if (!designId) return;

      try {
        setLoadingConverted(true);

        const designRef = doc(db, "designs", designId);
        const designSnap = await getDoc(designRef);

        if (!designSnap.exists()) return;

        const data = designSnap.data();

        if (data.type !== "2D") return;

        setDesignName(`${data.name || "Converted Design"} 3D`);
        setRoomWidth(Number(data.roomWidthFt) || 8);
        setRoomLength(Number(data.roomHeightFt) || 8);
        setRoomHeight(3);
        setIsPublic(!!data.isPublic);

        const convertedModels = convert2Dto3D(data.designData);
        setModels(convertedModels);

        Swal.fire({
          icon: "success",
          title: "2D Design Converted",
          text: "Your 2D layout has been loaded into the 3D workspace.",
          timer: 1800,
          showConfirmButton: false,
        });
      } catch (error) {
        console.error("2D to 3D conversion failed:", error);
        Swal.fire("Error", "Failed to convert 2D design to 3D.", "error");
      } finally {
        setLoadingConverted(false);
      }
    };

    if (!checkingAuth && user && designId) {
      load2DDesignAndConvert();
    }
  }, [checkingAuth, user, designId, convert2Dto3D]);

  /* =========================
     CONSTRAINT HELPERS
  ========================= */

  const registerRef = useCallback((id, node) => {
    if (node) {
      modelRefs.current[id] = node;
    } else {
      delete modelRefs.current[id];
    }
  }, []);

  const rememberTransform = useCallback((id, node) => {
    if (!node) return;

    previousTransforms.current[id] = {
      position: node.position.toArray(),
      rotation: [node.rotation.x, node.rotation.y, node.rotation.z],
      scale: node.scale.toArray(),
    };
  }, []);

  const restoreTransform = (node, saved) => {
    if (!node || !saved) return;
    node.position.set(...saved.position);
    node.rotation.set(...saved.rotation);
    node.scale.set(...saved.scale);
    node.updateWorldMatrix(true, true);
  };

  const syncStateFromNode = useCallback((id, node) => {
    if (!node) return;

    setModels((prev) =>
      prev.map((m) =>
        m.id === id
          ? {
              ...m,
              position: node.position.toArray(),
              rotation: [node.rotation.x, node.rotation.y, node.rotation.z],
              scale: node.scale.toArray(),
            }
          : m
      )
    );
  }, []);

  const snapNodeToFloor = (node) => {
    if (!node) return;

    node.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(node);

    if (Number.isFinite(box.min.y)) {
      node.position.y += -box.min.y;
      node.updateWorldMatrix(true, true);
    }
  };

  const hasCollision = (id, node) => {
    if (!node) return false;

    node.updateWorldMatrix(true, true);
    const currentBox = new THREE.Box3().setFromObject(node);

    for (const [otherId, otherNode] of Object.entries(modelRefs.current)) {
      if (String(id) === String(otherId) || !otherNode) continue;

      otherNode.updateWorldMatrix(true, true);
      const otherBox = new THREE.Box3().setFromObject(otherNode);

      if (currentBox.intersectsBox(otherBox)) {
        return true;
      }
    }

    return false;
  };

  const applyConstraintsAndSync = useCallback(
    (id, node) => {
      if (!node) return;

      snapNodeToFloor(node);

      const collided = hasCollision(id, node);

      if (collided) {
        restoreTransform(node, previousTransforms.current[id]);
        setCollisionMessage("Collision detected. Furniture cannot overlap.");
      } else {
        setCollisionMessage("");
      }

      syncStateFromNode(id, node);
    },
    [syncStateFromNode]
  );

  const applyDirectTransform = (id, mutator) => {
    const node = modelRefs.current[id];
    if (!node) return;

    rememberTransform(id, node);
    mutator(node);
    node.updateWorldMatrix(true, true);
    applyConstraintsAndSync(id, node);
  };

  /* =========================
     ACTIONS
  ========================= */

  const handleAddModel = () => {
    const id = Date.now();
    const path = modelPaths[modelType];
    const fileType = path.endsWith(".obj") ? "obj" : "glb";

    const offset = models.length * 1.6;

    const newModel = {
      id,
      name: modelType,
      path,
      fileType,
      position: [offset, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    };

    setModels((prev) => [...prev, newModel]);
    setSelectedModelId(id);
  };

  const deleteModel = (id) => {
    setModels((prev) => prev.filter((m) => m.id !== id));
    delete modelRefs.current[id];
    delete previousTransforms.current[id];

    if (selectedModelId === id) setSelectedModelId(null);
  };

  const handleScaleUp = (id) => {
    applyDirectTransform(id, (node) => {
      node.scale.set(
        node.scale.x + 0.1,
        node.scale.y + 0.1,
        node.scale.z + 0.1
      );
    });
  };

  const handleScaleDown = (id) => {
    applyDirectTransform(id, (node) => {
      node.scale.set(
        Math.max(0.1, node.scale.x - 0.1),
        Math.max(0.1, node.scale.y - 0.1),
        Math.max(0.1, node.scale.z - 0.1)
      );
    });
  };

  const handleRotateLeft = (id) => {
    applyDirectTransform(id, (node) => {
      node.rotation.y += 0.1;
    });
  };

  const handleRotateRight = (id) => {
    applyDirectTransform(id, (node) => {
      node.rotation.y -= 0.1;
    });
  };

  const handleSubmit = async () => {
    if (!user) {
      Swal.fire("Please login first.");
      navigate("/login");
      return;
    }

    if (!designName.trim()) {
      Swal.fire("Validation", "Please enter a design name.", "warning");
      return;
    }

    if (models.length === 0) {
      Swal.fire("Validation", "Add at least one model.", "warning");
      return;
    }

    try {
      setSaving(true);

      await addDoc(collection(db, "designs"), {
        name: designName.trim(),
        type: "3D",
        isPublic,
        userId: user.uid,
        userEmail: user.email || "",
        roomWidth,
        roomLength,
        roomHeight,
        wallColor,
        floorColor,
        shade,
        source2DDesignId: designId || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        designData: {
          objects: models,
        },
      });

      await Swal.fire("Success", "3D design saved successfully.", "success");
      navigate("/dashboard");
    } catch (error) {
      console.error(error);
      Swal.fire("Error", "Could not save design", "error");
    } finally {
      setSaving(false);
    }
  };

  if (checkingAuth || loadingConverted) {
    return <div className="design3d-loading">Preparing 3D workspace...</div>;
  }

  return (
    <div className="design3d-page">
      <div className="design3d-layout">
        <aside className="design3d-sidebar">
          <button
            onClick={() => navigate("/dashboard")}
            className="design3d-back-btn"
          >
            ←
          </button>

          <h2>Create 3D Design</h2>
          <p className="design3d-subtitle">
            Customize the room and place 3D furniture models to build your final
            concept.
          </p>

          <div className="design3d-form-group">
            <label>Design Name</label>
            <input
              type="text"
              className="design3d-input"
              value={designName}
              onChange={(e) => setDesignName(e.target.value)}
              placeholder="Enter design name"
            />
          </div>

          <div className="design3d-form-group">
            <label>Room Width</label>
            <input
              type="range"
              min="3"
              max="20"
              value={roomWidth}
              onChange={(e) => setRoomWidth(parseFloat(e.target.value))}
            />
            <div className="range-value">{roomWidth} meters</div>
          </div>

          <div className="design3d-form-group">
            <label>Room Length</label>
            <input
              type="range"
              min="3"
              max="20"
              value={roomLength}
              onChange={(e) => setRoomLength(parseFloat(e.target.value))}
            />
            <div className="range-value">{roomLength} meters</div>
          </div>

          <div className="design3d-form-group">
            <label>Room Height</label>
            <input
              type="range"
              min="2"
              max="6"
              value={roomHeight}
              onChange={(e) => setRoomHeight(parseFloat(e.target.value))}
            />
            <div className="range-value">{roomHeight} meters</div>
          </div>

          <div className="design3d-form-group">
            <label>Wall Color</label>
            <input
              type="color"
              value={wallColor}
              onChange={(e) => setWallColor(e.target.value)}
              className="design3d-color"
            />
          </div>

          <div className="design3d-form-group">
            <label>Floor Color</label>
            <input
              type="color"
              value={floorColor}
              onChange={(e) => setFloorColor(e.target.value)}
              className="design3d-color"
            />
          </div>

          <div className="design3d-form-group">
            <label>Room Lighting (Shade)</label>
            <input
              type="range"
              min="20"
              max="150"
              value={shade}
              onChange={(e) => setShade(parseInt(e.target.value, 10))}
            />
            <div className="range-value">{shade}% brightness</div>
          </div>

          <div className="design3d-form-group">
            <label>Select Model</label>
            <select
              className="design3d-select"
              value={modelType}
              onChange={(e) => setModelType(e.target.value)}
            >
              {Object.keys(modelPaths).map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </div>

          <button className="design3d-primary-btn" onClick={handleAddModel}>
            Add Model
          </button>

          <label className="design3d-checkbox-row">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            <span>Make this design public</span>
          </label>

          <button
            className="design3d-save-btn"
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Design"}
          </button>

          {collisionMessage && (
            <div className="design3d-collision-note">{collisionMessage}</div>
          )}

          {models.length > 0 && (
            <div className="design3d-models">
              <h4>Manage Objects</h4>

              {models.map((obj) => (
                <div key={obj.id} className="design3d-model-card">
                  <div className="design3d-model-top">
                    <strong>{obj.name}</strong>
                    <button
                      className="delete-icon-btn"
                      onClick={() => deleteModel(obj.id)}
                    >
                      <FaTrash />
                    </button>
                  </div>

                  <div className="design3d-model-actions">
                    <button onClick={() => handleScaleUp(obj.id)}>Scale +</button>
                    <button onClick={() => handleScaleDown(obj.id)}>Scale -</button>
                  </div>

                  <div className="design3d-model-actions">
                    <button onClick={() => handleRotateLeft(obj.id)}>Rotate ➡</button>
                    <button onClick={() => handleRotateRight(obj.id)}>Rotate ⬅</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>

        <main className="design3d-main">
          <div className="design3d-main-header">
            <h1>3D Design Workspace</h1>
            <p>Drag, rotate, and scale your models inside the room.</p>
          </div>

          <div className="design3d-canvas-card">
            <Canvas
              shadows
              camera={{ position: [10, 6, 10], fov: 50 }}
              onPointerMissed={() => setSelectedModelId(null)}
            >
              <ambientLight intensity={shade / 100} />
              <directionalLight
                castShadow
                position={[5, 10, 5]}
                intensity={1.2}
                shadow-mapSize-width={2048}
                shadow-mapSize-height={2048}
                shadow-camera-near={0.5}
                shadow-camera-far={50}
                shadow-camera-left={-20}
                shadow-camera-right={20}
                shadow-camera-top={20}
                shadow-camera-bottom={-20}
              />

              <spotLight
                castShadow
                position={[0, roomHeight + 4, 0]}
                angle={0.45}
                penumbra={0.5}
                intensity={0.6}
                distance={50}
              />

              <OrbitControls enablePan={false} />

              <Suspense fallback={null}>
                <WallsAndFloor
                  roomWidth={roomWidth}
                  roomLength={roomLength}
                  roomHeight={roomHeight}
                  wallColor={wallColor}
                  floorColor={floorColor}
                />

                {models.map((model) => (
                  <ModelMesh
                    key={model.id}
                    model={model}
                    selected={selectedModelId === model.id}
                    onSelect={setSelectedModelId}
                    registerRef={registerRef}
                    rememberTransform={rememberTransform}
                    applyConstraintsAndSync={applyConstraintsAndSync}
                  />
                ))}
              </Suspense>
            </Canvas>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Design3D;
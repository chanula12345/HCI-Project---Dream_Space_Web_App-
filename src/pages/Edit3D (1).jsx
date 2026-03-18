import React, {
  useState,
  useRef,
  useEffect,
  Suspense,
  useCallback,
} from "react";
import { Canvas, useLoader, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, TransformControls } from "@react-three/drei";
import { OBJLoader } from "three-stdlib";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import Swal from "sweetalert2";
import { useNavigate, useParams } from "react-router-dom";
import { FaTrash } from "react-icons/fa";
import * as THREE from "three";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
  updateDoc,
  addDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";

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
      ref.current.name = String(model.id);
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

const Edit3D = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [designName, setDesignName] = useState("Edited 3D Design");
  const [models, setModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState(null);

  const [roomWidth, setRoomWidth] = useState(8);
  const [roomLength, setRoomLength] = useState(8);
  const [roomHeight, setRoomHeight] = useState(3);
  const [wallColor, setWallColor] = useState("#f5f5f5");
  const [floorColor, setFloorColor] = useState("#e0cda9");
  const [shade, setShade] = useState(100);
  const [isPublic, setIsPublic] = useState(false);
  const [collisionMessage, setCollisionMessage] = useState("");

  const [modelType, setModelType] = useState("Chair1");

  const modelRefs = useRef({});
  const previousTransforms = useRef({});

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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        navigate("/login");
        return;
      }
      setUser(currentUser);
      setCheckingAuth(false);
    });

    return () => unsub();
  }, [navigate]);

  useEffect(() => {
    if (!checkingAuth && user) {
      fetchDesign();
    }
  }, [checkingAuth, user, id]);

  const registerRef = useCallback((modelId, node) => {
    if (node) {
      modelRefs.current[modelId] = node;
    } else {
      delete modelRefs.current[modelId];
    }
  }, []);

  const rememberTransform = useCallback((modelId, node) => {
    if (!node) return;

    previousTransforms.current[modelId] = {
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

  const syncStateFromNode = useCallback((modelId, node) => {
    if (!node) return;

    setModels((prev) =>
      prev.map((m) =>
        m.id === modelId
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

  const hasCollision = (modelId, node) => {
    if (!node) return false;

    node.updateWorldMatrix(true, true);
    const currentBox = new THREE.Box3().setFromObject(node);

    for (const [otherId, otherNode] of Object.entries(modelRefs.current)) {
      if (String(modelId) === String(otherId) || !otherNode) continue;

      otherNode.updateWorldMatrix(true, true);
      const otherBox = new THREE.Box3().setFromObject(otherNode);

      if (currentBox.intersectsBox(otherBox)) {
        return true;
      }
    }

    return false;
  };

  const applyConstraintsAndSync = useCallback(
    (modelId, node) => {
      if (!node) return;

      snapNodeToFloor(node);

      const collided = hasCollision(modelId, node);

      if (collided) {
        restoreTransform(node, previousTransforms.current[modelId]);
        setCollisionMessage("Collision detected. Furniture cannot overlap.");
      } else {
        setCollisionMessage("");
      }

      syncStateFromNode(modelId, node);
    },
    [syncStateFromNode]
  );

  const applyDirectTransform = (modelId, mutator) => {
    const node = modelRefs.current[modelId];
    if (!node) return;

    rememberTransform(modelId, node);
    mutator(node);
    node.updateWorldMatrix(true, true);
    applyConstraintsAndSync(modelId, node);
  };

  const fetchDesign = async () => {
    try {
      setLoading(true);

      const docRef = doc(db, "designs", id);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        await Swal.fire("Error", "Design not found", "error");
        navigate("/dashboard");
        return;
      }

      const data = docSnap.data();

      if (data.userId !== auth.currentUser?.uid) {
        await Swal.fire(
          "Access denied",
          "You can only edit your own designs.",
          "warning"
        );
        navigate("/dashboard");
        return;
      }

      setDesignName(data.name || "Edited 3D Design");
      setModels(data.designData?.objects || []);
      setRoomWidth(data.roomWidth || 8);
      setRoomLength(data.roomLength || 8);
      setRoomHeight(data.roomHeight || 3);
      setWallColor(data.wallColor || "#f5f5f5");
      setFloorColor(data.floorColor || "#e0cda9");
      setShade(data.shade || 100);
      setIsPublic(!!data.isPublic);
    } catch (error) {
      console.error(error);
      Swal.fire("Error", "Failed to load design", "error");
    } finally {
      setLoading(false);
    }
  };

  const addModel = () => {
    const path = modelPaths[modelType];
    const fileType = path.endsWith(".obj") ? "obj" : "glb";
    const offset = models.length * 1.6;

    const newModel = {
      id: Date.now(),
      name: modelType,
      path,
      fileType,
      position: [offset, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    };

    setModels((prev) => [...prev, newModel]);
    setSelectedModelId(newModel.id);
  };

  const deleteModel = (targetId) => {
    setModels((prev) => prev.filter((m) => m.id !== targetId));
    delete modelRefs.current[targetId];
    delete previousTransforms.current[targetId];

    if (selectedModelId === targetId) setSelectedModelId(null);
  };

  const handleScaleUp = (targetId) => {
    applyDirectTransform(targetId, (node) => {
      node.scale.set(
        node.scale.x + 0.1,
        node.scale.y + 0.1,
        node.scale.z + 0.1
      );
    });
  };

  const handleScaleDown = (targetId) => {
    applyDirectTransform(targetId, (node) => {
      node.scale.set(
        Math.max(0.1, node.scale.x - 0.1),
        Math.max(0.1, node.scale.y - 0.1),
        Math.max(0.1, node.scale.z - 0.1)
      );
    });
  };

  const handleRotateLeft = (targetId) => {
    applyDirectTransform(targetId, (node) => {
      node.rotation.y += 0.1;
    });
  };

  const handleRotateRight = (targetId) => {
    applyDirectTransform(targetId, (node) => {
      node.rotation.y -= 0.1;
    });
  };

  const buildPayload = (overrideName = null) => ({
    name: (overrideName || designName).trim(),
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
    updatedAt: serverTimestamp(),
    designData: {
      objects: models,
    },
  });

  const handleUpdate = async () => {
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

      const payload = buildPayload();
      await updateDoc(doc(db, "designs", id), payload);

      await Swal.fire("Success", "3D design updated successfully.", "success");
      navigate(`/design-details/${id}`);
    } catch (error) {
      console.error(error);
      Swal.fire("Error", "Could not update design", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAsNew = async () => {
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

      const payload = buildPayload(`${designName} (Edited)`);

      await addDoc(collection(db, "designs"), {
        ...payload,
        createdAt: serverTimestamp(),
      });

      await Swal.fire("Success", "Design saved as new successfully.", "success");
      navigate("/dashboard");
    } catch (error) {
      console.error(error);
      Swal.fire("Error", "Could not save design", "error");
    } finally {
      setSaving(false);
    }
  };

  if (checkingAuth || loading) {
    return <div className="design3d-loading">Loading 3D editor...</div>;
  }

  return (
    <div className="design3d-page">
      <div className="design3d-layout">
        <aside className="design3d-sidebar">
          <button
            onClick={() => navigate(`/design-details/${id}`)}
            className="design3d-back-btn"
          >
            ←
          </button>

          <h2>Edit 3D Design</h2>
          <p className="design3d-subtitle">
            Update the room setup and modify 3D furniture placements.
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

          <button className="design3d-primary-btn" onClick={addModel}>
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
            onClick={handleUpdate}
            disabled={saving}
            style={{ marginBottom: "10px" }}
          >
            {saving ? "Saving..." : "Update Design"}
          </button>

          <button
            className="design3d-primary-btn"
            onClick={handleSaveAsNew}
            disabled={saving}
          >
            Save as New Design
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
            <h1>Edit 3D Workspace</h1>
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

export default Edit3D;
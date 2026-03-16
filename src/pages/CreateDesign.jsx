import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { onAuthStateChanged } from "firebase/auth";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { auth, db, storage } from "../firebase";
import "../styles/CreateDesign.css";
import objectImages from "../data/objectImages";

const gridSize = 20;

const CreateDesign = () => {
  const navigate = useNavigate();
  const previewRef = useRef(null);
  const dragRef = useRef({ id: null, offsetX: 0, offsetY: 0 });

  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [name, setName] = useState("");
  const [type] = useState("2D");
  const [isPublic, setIsPublic] = useState(false);
  const [objects, setObjects] = useState([]);
  const [selectedObjectType, setSelectedObjectType] = useState(
    objectImages[0]?.type || ""
  );

  const [roomWidthFt, setRoomWidthFt] = useState(30);
  const [roomHeightFt, setRoomHeightFt] = useState(20);
  const [roomShape, setRoomShape] = useState("rectangle");

  const [bgImageFile, setBgImageFile] = useState(null);
  const [bgPreview, setBgPreview] = useState(null);
  const [saving, setSaving] = useState(false);

  /* =============================
     AUTH CHECK
  ============================= */

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

  /* =============================
     ADD OBJECT
  ============================= */

  const addObject = () => {
    const config = objectImages.find((obj) => obj.type === selectedObjectType);
    if (!config) return;

    const newObj = {
      id: Date.now(),
      type: config.type,
      label: config.label,
      image: config.image,
      x: 40,
      y: 40,
      width: 80,
      height: 80,
      rotateX: 0,
      rotateY: 0,
      rotation: 0,
    };

    setObjects((prev) => [...prev, newObj]);
  };

  const handleDelete = (id) => {
    setObjects((prev) => prev.filter((obj) => obj.id !== id));
  };

  const updateObject = (id, field, value) => {
    setObjects((prev) =>
      prev.map((obj) =>
        obj.id === id ? { ...obj, [field]: parseFloat(value) || 0 } : obj
      )
    );
  };

  const cloneObject = (obj) => {
    const cloned = {
      ...obj,
      id: Date.now(),
      x: obj.x + 20,
      y: obj.y + 20,
    };

    setObjects((prev) => [...prev, cloned]);
  };

  /* =============================
     DRAG LOGIC
  ============================= */

  const startDrag = (e, id) => {
    const obj = objects.find((o) => o.id === id);
    if (!obj || !previewRef.current) return;

    const bounds = previewRef.current.getBoundingClientRect();

    dragRef.current = {
      id,
      offsetX: e.clientX - bounds.left - obj.x,
      offsetY: e.clientY - bounds.top - obj.y,
    };

    window.addEventListener("mousemove", handleDragMove);
    window.addEventListener("mouseup", stopDrag);
  };

  const handleDragMove = (e) => {
    const { id, offsetX, offsetY } = dragRef.current;
    if (!id || !previewRef.current) return;

    const bounds = previewRef.current.getBoundingClientRect();

    let x =
      Math.round((e.clientX - bounds.left - offsetX) / gridSize) * gridSize;
    let y =
      Math.round((e.clientY - bounds.top - offsetY) / gridSize) * gridSize;

    x = Math.max(0, x);
    y = Math.max(0, y);

    setObjects((prev) =>
      prev.map((obj) => (obj.id === id ? { ...obj, x, y } : obj))
    );
  };

  const stopDrag = () => {
    dragRef.current = { id: null, offsetX: 0, offsetY: 0 };
    window.removeEventListener("mousemove", handleDragMove);
    window.removeEventListener("mouseup", stopDrag);
  };

  /* =============================
     BACKGROUND IMAGE
  ============================= */

  const handleBgChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBgImageFile(file);
    setBgPreview(URL.createObjectURL(file));
  };

  /* =============================
     EXPORT PDF
  ============================= */

  const handleExportPDF = async () => {
    if (!previewRef.current) return;

    try {
      const canvas = await html2canvas(previewRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
      });

      const pdf = new jsPDF("landscape", "pt", "a4");
      const imgData = canvas.toDataURL("image/png");

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const imgWidth = canvas.width;
      const imgHeight = canvas.height;

      const ratio = Math.min(
        (pageWidth - 60) / imgWidth,
        (pageHeight - 80) / imgHeight
      );

      const finalWidth = imgWidth * ratio;
      const finalHeight = imgHeight * ratio;

      const x = (pageWidth - finalWidth) / 2;
      const y = 40;

      pdf.text(name || "Design Preview", 40, 25);
      pdf.addImage(imgData, "PNG", x, y, finalWidth, finalHeight);
      pdf.save(`${name || "design"}.pdf`);
    } catch (error) {
      console.error(error);
      Swal.fire("Error", "Failed to export PDF", "error");
    }
  };

  /* =============================
     2D -> 3D MODEL MAPPING
  ============================= */

  const getMappedModelName = useCallback((type) => {
    const safeType = (type || "").toLowerCase();

    if (safeType.includes("bed1") || safeType.includes("bed2") || safeType.includes("bed")) {
      return "Sofa2";
    }

    if (safeType.includes("chair2")) {
      return "Chair2";
    }

    if (safeType.includes("chair1") || safeType.includes("chair")) {
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

    if (safeType.includes("game")) {
      return "GamingChair";
    }

    return "Chair1";
  }, []);

  const getMappedModelPath = useCallback((mappedName) => {
    const modelPathMap = {
      Bookrack: "/models/Bookrack.glb",
      Chair1: "/models/Chair1.glb",
      Chair2: "/models/Chair2.glb",
      Coffeetable: "/models/coffeetable.glb",
      GamingChair: "/models/gamingchair.glb",
      Rack2: "/models/rack2.glb",
      Couch: "/models/couch02.glb",
      Sofa: "/models/sofa1.glb",
      Sofa2: "/models/soffaaaa.glb",
    };

    return modelPathMap[mappedName] || "/models/Chair1.glb";
  }, []);

  const getConvertedModelScale = useCallback((mappedName, obj) => {
    const w = obj?.width || 80;
    const h = obj?.height || 80;

    if (mappedName === "Chair1" || mappedName === "Chair2") {
      return [
        Math.max(0.35, w / 180),
        Math.max(0.35, h / 180),
        Math.max(0.35, w / 180),
      ];
    }

    if (mappedName === "Coffeetable") {
      return [
        Math.max(0.45, w / 150),
        Math.max(0.45, h / 150),
        Math.max(0.45, w / 150),
      ];
    }

    if (mappedName === "Sofa" || mappedName === "Sofa2" || mappedName === "Couch") {
      return [
        Math.max(0.5, w / 160),
        Math.max(0.5, h / 160),
        Math.max(0.5, w / 160),
      ];
    }

    if (mappedName === "Rack2" || mappedName === "Bookrack") {
      return [
        Math.max(0.45, w / 170),
        Math.max(0.45, h / 140),
        Math.max(0.45, w / 170),
      ];
    }

    if (mappedName === "GamingChair") {
      return [
        Math.max(0.45, w / 170),
        Math.max(0.45, h / 170),
        Math.max(0.45, w / 170),
      ];
    }

    return [0.5, 0.5, 0.5];
  }, []);

  /* =============================
     2D -> 3D CONVERSION
  ============================= */

  const convert2Dto3D = () => {
    if (objects.length === 0) {
      Swal.fire("Add objects first.");
      return;
    }

    const roomData = {
      roomWidth: Number(roomWidthFt) || 8,
      roomLength: Number(roomHeightFt) || 8,
      roomHeight: 3,
      roomShape,
      designName: name?.trim() ? `${name.trim()} 3D` : "My 3D Design",
      models: objects.map((obj, index) => {
        const mappedName = getMappedModelName(obj.type || obj.label || "");
        const mappedPath = getMappedModelPath(mappedName);

        return {
          id: Date.now() + index + Math.random(),
          name: mappedName,
          source2DType: obj.type || obj.label || "",
          path: mappedPath,
          fileType: mappedPath.endsWith(".obj") ? "obj" : "glb",
          position: [
            (obj.x || 0) * 0.05,
            0,
            (obj.y || 0) * 0.05,
          ],
          rotation: [0, ((obj.rotation || 0) * Math.PI) / 180, 0],
          scale: getConvertedModelScale(mappedName, obj),
        };
      }),
    };

    localStorage.setItem("converted3DDesign", JSON.stringify(roomData));
    navigate("/design3d");
  };

  /* =============================
     FIREBASE UPLOAD
  ============================= */

  const uploadBackgroundIfNeeded = async () => {
    if (!bgImageFile || !user) return null;

    const safeName = `${Date.now()}_${bgImageFile.name}`;
    const storageRef = ref(
      storage,
      `design-backgrounds/${user.uid}/${safeName}`
    );

    await uploadBytes(storageRef, bgImageFile);
    return await getDownloadURL(storageRef);
  };

  /* =============================
     SAVE DESIGN
  ============================= */

  const handleSubmit = async () => {
    if (!user) {
      Swal.fire("Please login first.");
      navigate("/login");
      return;
    }

    if (!name.trim()) {
      Swal.fire("Validation", "Please enter a design name.", "warning");
      return;
    }

    if (objects.length === 0) {
      Swal.fire("Validation", "Please add at least one object.", "warning");
      return;
    }

    setSaving(true);

    try {
      const backgroundUrl = await uploadBackgroundIfNeeded();

      const cleanedObjects = objects.map((obj) => ({
        id: obj.id,
        type: obj.type,
        label: obj.label || obj.type,
        image: obj.image,
        x: obj.x,
        y: obj.y,
        width: obj.width,
        height: obj.height,
        rotateX: obj.rotateX || 0,
        rotateY: obj.rotateY || 0,
        rotation: obj.rotation || 0,
      }));

      await addDoc(collection(db, "designs"), {
        name: name.trim(),
        type,
        isPublic,
        userId: user.uid,
        userEmail: user.email || "",
        roomWidthFt: Number(roomWidthFt) || 0,
        roomHeightFt: Number(roomHeightFt) || 0,
        roomShape,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        designData: {
          background: backgroundUrl || null,
          objects: cleanedObjects,
        },
      });

      await Swal.fire("Success", "Design saved successfully.", "success");
      navigate("/dashboard");
    } catch (error) {
      console.error(error);
      Swal.fire("Error", "Could not save design.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (checkingAuth) {
    return <div className="create-loading">Checking authentication...</div>;
  }

  return (
    <div className="create-design-page">
      <div className="create-layout">
        <aside className="create-sidebar">
          <button
            onClick={() => navigate("/dashboard")}
            className="create-back-btn"
          >
            ←
          </button>

          <h2>Create New Design</h2>

          <p className="create-subtitle">
            Build your 2D furniture layout and convert it to 3D.
          </p>

          <div className="create-form-group">
            <label>Design Name</label>
            <input
              type="text"
              className="create-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="create-room-grid">
            <div className="create-form-group">
              <label>Room Width (ft)</label>
              <input
                type="number"
                className="create-input"
                value={roomWidthFt}
                onChange={(e) => setRoomWidthFt(parseFloat(e.target.value) || 0)}
              />
            </div>

            <div className="create-form-group">
              <label>Room Height (ft)</label>
              <input
                type="number"
                className="create-input"
                value={roomHeightFt}
                onChange={(e) => setRoomHeightFt(parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="create-form-group">
            <label>Room Shape</label>
            <select
              className="create-select"
              value={roomShape}
              onChange={(e) => setRoomShape(e.target.value)}
            >
              <option value="rectangle">Rectangle</option>
              <option value="square">Square</option>
              <option value="lshape">L-Shape</option>
            </select>
          </div>

          <div className="create-form-group">
            <label>Background Image</label>
            <input
              type="file"
              className="create-input"
              accept="image/*"
              onChange={handleBgChange}
            />
          </div>

          <div className="create-form-group">
            <label>Select Object</label>

            <div className="create-object-row">
              <select
                className="create-select"
                value={selectedObjectType}
                onChange={(e) => setSelectedObjectType(e.target.value)}
              >
                {objectImages.map((obj) => (
                  <option key={obj.type} value={obj.type}>
                    {obj.label}
                  </option>
                ))}
              </select>

              <button className="create-add-btn" onClick={addObject}>
                +
              </button>
            </div>
          </div>

          {objects.length > 0 && (
            <div className="create-properties">
              <h4>Edit Object Properties</h4>

              {objects.map((obj) => (
                <div key={obj.id} className="object-card">
                  <div className="object-card-top">
                    <strong>{obj.type}</strong>

                    <div className="object-card-actions">
                      <button
                        type="button"
                        className="object-small-btn secondary"
                        onClick={() => cloneObject(obj)}
                      >
                        Clone
                      </button>

                      <button
                        type="button"
                        className="object-small-btn danger"
                        onClick={() => handleDelete(obj.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="object-grid">
                    <input
                      type="number"
                      className="create-input"
                      value={(obj.width / 20).toFixed(1)}
                      onChange={(e) =>
                        updateObject(
                          obj.id,
                          "width",
                          parseFloat(e.target.value) * 20
                        )
                      }
                      placeholder="Width (ft)"
                    />

                    <input
                      type="number"
                      className="create-input"
                      value={(obj.height / 20).toFixed(1)}
                      onChange={(e) =>
                        updateObject(
                          obj.id,
                          "height",
                          parseFloat(e.target.value) * 20
                        )
                      }
                      placeholder="Height (ft)"
                    />

                    <input
                      type="number"
                      className="create-input"
                      value={obj.rotateX || 0}
                      onChange={(e) =>
                        updateObject(obj.id, "rotateX", e.target.value)
                      }
                      placeholder="Rotate X"
                    />

                    <input
                      type="number"
                      className="create-input"
                      value={obj.rotateY || 0}
                      onChange={(e) =>
                        updateObject(obj.id, "rotateY", e.target.value)
                      }
                      placeholder="Rotate Y"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <label className="create-checkbox-row">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            <span>Make this design public</span>
          </label>

          <button
            className="create-primary-btn"
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Design"}
          </button>

          <button className="create-secondary-btn" onClick={handleExportPDF}>
            Export to PDF
          </button>

          <button className="create-primary-btn" onClick={convert2Dto3D}>
            Convert to 3D
          </button>
        </aside>

        <main className="create-main">
          <div className="create-main-header">
            <h1>Create 2D Design</h1>
            <p>Drag objects to design your layout.</p>
          </div>

          <div className="create-canvas-card">
            <div
              ref={previewRef}
              className={`create-canvas-board room-shape-${roomShape}`}
              style={{
                width:
                  roomShape === "square"
                    ? `${roomHeightFt * gridSize}px`
                    : `${roomWidthFt * gridSize}px`,
                height: `${roomHeightFt * gridSize}px`,
                backgroundImage: bgPreview ? `url(${bgPreview})` : "none",
              }}
            >
              {objects.map((obj) => (
                <img
                  key={obj.id}
                  src={obj.image}
                  alt={obj.type}
                  onMouseDown={(e) => startDrag(e, obj.id)}
                  onDoubleClick={() => handleDelete(obj.id)}
                  style={{
                    position: "absolute",
                    left: obj.x,
                    top: obj.y,
                    width: obj.width,
                    height: obj.height,
                    transform: `rotate(${obj.rotation}deg)`,
                    cursor: "grab",
                    userSelect: "none",
                  }}
                  draggable={false}
                />
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default CreateDesign;
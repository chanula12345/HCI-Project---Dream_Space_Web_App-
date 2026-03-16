export function convert2Dto3D(objects) {

  const scaleFactor = 0.01;

  const models = [];

  objects.forEach(obj => {

    if(obj.type === "chair"){

      models.push({
        id: Date.now() + Math.random(),
        name: "Chair1",
        path: "/models/Chair1.glb",
        fileType: "glb",

        position:[
          obj.left * scaleFactor,
          0,
          obj.top * scaleFactor
        ],

        rotation:[0,0,0],
        scale:[0.5,0.5,0.5]
      });

    }

    if(obj.type === "table"){

      models.push({
        id: Date.now() + Math.random(),
        name:"Coffeetable",
        path:"/models/coffeetable.glb",
        fileType:"glb",

        position:[
          obj.left * scaleFactor,
          0,
          obj.top * scaleFactor
        ],

        rotation:[0,0,0],
        scale:[0.5,0.5,0.5]
      });

    }

  });

  return models;

}
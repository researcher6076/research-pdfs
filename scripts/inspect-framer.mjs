import { connect } from "framer-api"

const projectUrl = process.env.FRAMER_PROJECT_URL
const apiKey = process.env.FRAMER_API_KEY

if (!projectUrl || !apiKey) {
  throw new Error(
    "FRAMER_PROJECT_URL and FRAMER_API_KEY must be configured."
  )
}

const framer = await connect(projectUrl, apiKey)

try {
  const project = await framer.getProjectInfo()
  console.log(`Connected to Framer project: ${project.name}`)
  console.log("\nCMS collections and fields:\n")

  const collections = await framer.getCollections()

  for (const collection of collections) {
    console.log(`Collection: ${collection.name ?? "(unnamed)"}`)
    console.log(`Collection ID: ${collection.id}`)

    const fields = await collection.getFields()

    for (const field of fields) {
      console.log(
        `  Field: ${field.name} | Type: ${field.type} | ID: ${field.id}`
      )
    }

    console.log("")
  }
} finally {
  await framer.disconnect()
}

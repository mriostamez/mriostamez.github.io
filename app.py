from fastapi import FastAPI, Request
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class DataModel(BaseModel):
    key: str

@app.post("/receive-data")
async def receive_data(data: DataModel):
    print(f"Received data: {data}")
    response = {
        'status': 'success',
        'message': 'Data received successfully',
        'received_data': data.model_dump()
    }
    return response

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="https://humble-barnacle-pjrrvr59w9x27px9.github.dev", port=8000)

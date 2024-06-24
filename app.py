from fastapi import FastAPI, Request
from pydantic import BaseModel

app = FastAPI()

class DataModel(BaseModel):
    key: str

@app.post("/receive-data")
async def receive_data(data: DataModel):
    print(f"Received data: {data}")
    response = {
        'status': 'success',
        'message': 'Data received successfully',
        'received_data': data.dict()
    }
    return response

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

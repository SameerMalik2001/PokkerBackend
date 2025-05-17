import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  WebSocketServer,
  OnGatewayDisconnect,
  OnGatewayConnection,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

interface JoinData {
  username: string;
  room: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private usersMap = new Map<string, { username: string; room: string }>();
  private roomCreators = new Map<string, string>();
  private roomMessagesMap = new Map<string, string[][]>(); // 🆕 stores messages per room

  handleConnection(client: Socket): void {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    const userData = this.usersMap.get(client.id);
    if (userData) {
      const { username, room } = userData;
      console.log(`${username} has left the room`);

      this.server.to(room).emit('message', `${username} has left the room`);
      this.usersMap.delete(client.id);

      const usersInRoom = [...this.usersMap.entries()]
        .filter(([_, datas]) => datas.room === room)
        .map(([id, datas]) => ({ id, username: datas.username }));
      console.log({ usersInRoom });

      const roomMessages = this.roomMessagesMap.get(room) || [];

      this.server.to(room).emit('usersList', {
        status: 200,
        room: room,
        users: usersInRoom,
        messages: roomMessages,
      });

      const roomSockets = this.server.sockets.adapter.rooms.get(room);
      if (!roomSockets || roomSockets.size === 0) {
        this.roomCreators.delete(room);
        this.roomMessagesMap.delete(room); // 🧹 delete messages for the empty room
        console.log(`Room ${room} is now empty and deleted`);
      }
    }
  }

  @SubscribeMessage('create')
  async handleCreate(@MessageBody() data: JoinData, @ConnectedSocket() client: Socket) {
    if (!data?.room || !data?.username) return;

    if (this.roomCreators.has(data.room)) {
      const payload = {
        status: 400,
        msg: 'Room is in use'
      }
      client.emit('create', payload);
      return;
    }

    client.join(data.room);
    this.usersMap.set(client.id, { username: data.username, room: data.room });

    if (!this.roomCreators.has(data.room)) {
      this.roomCreators.set(data.room, data.username);
      const payload = {
        status: 200,
        clientId: client.id,
        msg: `Room created successfully`
      }
      client.emit('create', payload);
    }
  }

  @SubscribeMessage('join')
  async handleJoin(@MessageBody() data: JoinData, @ConnectedSocket() client: Socket) {
    if (!data?.room || !data?.username) return;
    console.log(this.roomCreators);
    if (!this.roomCreators.has(data.room)) {
      const payload = {
        status: 400,
        msg: 'RoomName is Invalid'
      }
      client.emit('join', payload);
      return;
    }

    client.join(data.room);
    this.usersMap.set(client.id, { username: data.username, room: data.room });

    const usersInRoom = [...this.usersMap.entries()]
      .filter(([_, datas]) => datas.room === data.room)
      .map(([id, datas]) => ({ id, username: datas.username }));
    console.log({ usersInRoom });

    const roomMessages = this.roomMessagesMap.get(data.room) || [];

    this.server.to(data.room).emit('usersList', {
      status: 200,
      room: data.room,
      users: usersInRoom,
      messages: roomMessages,
    });

    const previousMessages = this.roomMessagesMap.get(data.room) || [];
    client.emit('previousMessages', previousMessages);
    const payload = {
      status: 200,
      msg: `${data.username} has joined the room`,
      clientId: client.id
    }

    this.server.to(data.room).emit('join', payload);
  }

  @SubscribeMessage('message')
  async handleMessage(@MessageBody() message: string, @ConnectedSocket() client: Socket) {
    const userData = this.usersMap.get(client.id);
    if (!userData) return;

    const { username, room } = userData;
    const formattedMsg = [`${username}`,`${message}`];
    console.log(`[${room}] ${formattedMsg}`);

    // Store the message in roomMessagesMap
    if (!this.roomMessagesMap.has(room)) {
      this.roomMessagesMap.set(room, []);
    }
    this.roomMessagesMap.get(room)?.push(formattedMsg);

    const voterMap: Map<string, string> = new Map()
    const prevMessage = this.roomMessagesMap.get(room)
    prevMessage.forEach((item: string[]) => {
      if(item[1] !== '') {
        voterMap.set(item[0], item[1])
      }
    })
    const votesName = Array.from(voterMap.keys());
    this.server.to(room).emit('NumberSelectedUser', {status: 200, data:  votesName});


    this.server.to(room).emit('message', formattedMsg);
  }

  @SubscribeMessage('getUsers')
  handleGetUsers(@MessageBody() roomId: string, @ConnectedSocket() client: Socket) {
    if (!roomId) {
      client.emit('usersList', { status: 400, msg: 'Room ID required' });
      return;
    }

    console.log(this.usersMap);
    const usersInRoom = [...this.usersMap.entries()]
      .filter(([_, data]) => data.room === roomId)
      .map(([id, data]) => ({ id, username: data.username }));
    console.log({ usersInRoom });

    const roomMessages = this.roomMessagesMap.get(roomId) || [];

    client.emit('usersList', {
      status: 200,
      room: roomId,
      users: usersInRoom,
      messages: roomMessages,
    });
  }

  @SubscribeMessage('roomOwner')
  handleRoomOwner(@MessageBody() roomName: string, @ConnectedSocket() client: Socket) {
    if (!roomName) {
      client.emit('usersList', { status: 400, msg: 'Room ID required' });
      return;
    }

    client.emit('roomOwnerName', {
      status: 200,
      ownerUserName: this.roomCreators.get(roomName)
    });
  }

  @SubscribeMessage('getPreviousRoomMessage')
  handleGetPreviousRoomMessage(@MessageBody() roomName: string, @ConnectedSocket() client: Socket) {
    if (!roomName) {
      client.emit('usersList', { status: 400, msg: 'Room ID required' });
      return;
    }

    this.server.to(roomName).emit('previousMessagesOfRoom', {
      status: 200,
      previousMessages: this.roomMessagesMap.get(roomName)
    });
  }

  @SubscribeMessage('resetMessage')
  handleResetMessage(@MessageBody() roomName: string, @ConnectedSocket() client: Socket) {
    if (!roomName) {
      client.emit('usersList', { status: 400, msg: 'Room ID required' });
      return;
    }

    this.roomMessagesMap.delete(roomName)

    this.server.to(roomName).emit('resetMessage', {
      status: 200
    });
  }

}
